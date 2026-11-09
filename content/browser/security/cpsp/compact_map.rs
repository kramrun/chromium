// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

//! Ordered grant tables without a full B-tree node for a handful of entries.
//!
//! Small tables retain the same key ordering as `BTreeMap`. Promotion bounds
//! linear insertion work even for a renderer supplying many distinct origins.

use std::borrow::Borrow;
use std::collections::BTreeMap;

const SMALL_LIMIT: usize = 4;

#[derive(Debug)]
enum Storage<K, V> {
    Small(Vec<(K, V)>),
    Large(BTreeMap<K, V>),
}

#[derive(Debug)]
pub(crate) struct CompactMap<K, V> {
    storage: Storage<K, V>,
}

impl<K, V> Default for CompactMap<K, V> {
    fn default() -> Self {
        Self { storage: Storage::Small(Vec::new()) }
    }
}

impl<K: Ord, V> CompactMap<K, V> {
    pub(crate) fn get<Q: Ord + ?Sized>(&self, key: &Q) -> Option<&V>
    where
        K: Borrow<Q>,
    {
        match &self.storage {
            Storage::Small(entries) => entries
                .binary_search_by(|(stored, _)| stored.borrow().cmp(key))
                .ok()
                .map(|index| &entries[index].1),
            Storage::Large(entries) => entries.get(key),
        }
    }

    pub(crate) fn get_mut<Q: Ord + ?Sized>(&mut self, key: &Q) -> Option<&mut V>
    where
        K: Borrow<Q>,
    {
        match &mut self.storage {
            Storage::Small(entries) => entries
                .binary_search_by(|(stored, _)| stored.borrow().cmp(key))
                .ok()
                .map(|index| &mut entries[index].1),
            Storage::Large(entries) => entries.get_mut(key),
        }
    }

    pub(crate) fn contains_key<Q: Ord + ?Sized>(&self, key: &Q) -> bool
    where
        K: Borrow<Q>,
    {
        self.get(key).is_some()
    }

    pub(crate) fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.insert_internal(key, value, true)
    }

    /// Preserve the first stored value, including any stronger permission.
    pub(crate) fn insert_if_absent(&mut self, key: K, value: V) {
        self.insert_internal(key, value, false);
    }

    fn insert_internal(&mut self, key: K, value: V, replace: bool) -> Option<V> {
        match &mut self.storage {
            Storage::Small(entries) => {
                match entries.binary_search_by(|(stored, _)| stored.cmp(&key)) {
                    Ok(index) => {
                        return if replace {
                            Some(std::mem::replace(&mut entries[index].1, value))
                        } else {
                            None
                        };
                    }
                    Err(index) if entries.len() < SMALL_LIMIT => {
                        // Start at one slot and grow to two/four, rather
                        // than Vec's usual four-slot initial allocation.
                        if entries.len() == entries.capacity() {
                            entries.reserve_exact(entries.len().max(1));
                        }
                        entries.insert(index, (key, value));
                        return None;
                    }
                    Err(_) => {}
                }
            }
            Storage::Large(entries) => {
                if replace {
                    return entries.insert(key, value);
                }
                entries.entry(key).or_insert(value);
                return None;
            }
        }

        // The first distinct key past SMALL_LIMIT promotes once; duplicates
        // never do.
        let Storage::Small(entries) =
            std::mem::replace(&mut self.storage, Storage::Small(Vec::new()))
        else {
            unreachable!("Only a full small table needs promotion");
        };
        let mut tree: BTreeMap<K, V> = entries.into_iter().collect();
        tree.insert(key, value);
        self.storage = Storage::Large(tree);
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agrees_with_btree_across_promotion() {
        let mut compact = CompactMap::default();
        let mut reference = BTreeMap::new();
        let mut seed = 0x1234_5678_u32;
        for step in 0..4096 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let key = seed % 97;
            if step % 3 == 0 {
                compact.insert_if_absent(key, step);
                reference.entry(key).or_insert(step);
            } else {
                assert_eq!(compact.insert(key, step), reference.insert(key, step));
            }
            for key in 0..100 {
                assert_eq!(compact.get(&key), reference.get(&key));
            }
        }
        assert!(matches!(compact.storage, Storage::Large(_)));
    }

    #[test]
    fn duplicate_at_limit_preserves_key_and_permission() {
        let mut map = CompactMap::default();
        for key in (0..SMALL_LIMIT).rev() {
            map.insert(key, 2);
        }
        for key in 0..SMALL_LIMIT {
            map.insert_if_absent(key, 1);
            assert_eq!(map.get(&key), Some(&2));
        }
        assert!(matches!(map.storage, Storage::Small(_)));
        map.insert_if_absent(SMALL_LIMIT, 1);
        assert!(matches!(map.storage, Storage::Large(_)));
        assert_eq!(map.insert(0, 3), Some(2));
        assert_eq!(map.get(&0), Some(&3));
    }

    #[test]
    fn borrowed_scheme_lookup_and_upgrade() {
        let mut map = CompactMap::<Box<str>, u8>::default();
        for key in ["https", "file", "custom"] {
            map.insert(key.into(), 1);
        }
        *map.get_mut("custom").unwrap() = 2;
        map.insert_if_absent("custom".into(), 1);
        assert_eq!(map.get("custom"), Some(&2));
        assert!(!map.contains_key("unknown"));
        for index in 0..32 {
            map.insert(format!("scheme-{index}").into(), 1);
        }
        *map.get_mut("custom").unwrap() = 3;
        assert_eq!(map.get("custom"), Some(&3));
        assert!(map.get_mut("unknown").is_none());
    }

    #[test]
    fn promotion_and_duplicate_insertion_drop_owned_values_once() {
        use std::cell::Cell;
        use std::rc::Rc;

        struct Value(Rc<Cell<usize>>);
        impl Drop for Value {
            fn drop(&mut self) {
                self.0.set(self.0.get() + 1);
            }
        }

        let dropped = Rc::new(Cell::new(0));
        {
            let mut map = CompactMap::default();
            for key in 0..64 {
                map.insert(key, Value(dropped.clone()));
                map.insert_if_absent(key, Value(dropped.clone()));
            }
            assert_eq!(dropped.get(), 64);
            assert!(map.insert(0, Value(dropped.clone())).is_some());
            assert_eq!(dropped.get(), 65);
        }
        assert_eq!(dropped.get(), 129);
    }
}
