// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

//! Standalone allocation probe, not part of the browser or production crate.
//! Counts requested live heap bytes plus table-object storage, not RSS/PSS.
#![allow(dead_code)]

#[path = "../../../content/browser/security/cpsp/compact_map.rs"]
mod compact_map;

use compact_map::CompactMap;
use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::{BTreeMap, HashMap};
use std::hint::black_box;
use std::sync::atomic::{AtomicUsize, Ordering};

struct CountingAllocator;
static LIVE: AtomicUsize = AtomicUsize::new(0);

// SAFETY: Each operation forwards the original pointer/layout to System. The
// additional accounting never dereferences pointers, allocates, or panics.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            LIVE.fetch_add(layout.size(), Ordering::Relaxed);
        }
        pointer
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        unsafe { System.dealloc(pointer, layout) };
    }
    unsafe fn realloc(&self, pointer: *mut u8, old: Layout, new_size: usize) -> *mut u8 {
        let result = unsafe { System.realloc(pointer, old, new_size) };
        if !result.is_null() {
            LIVE.fetch_sub(old.size(), Ordering::Relaxed);
            LIVE.fetch_add(new_size, Ordering::Relaxed);
        }
        result
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

fn measure<T>(count: usize, mut build: impl FnMut() -> T) -> usize {
    let before = LIVE.load(Ordering::Relaxed);
    let tables: Vec<T> = (0..count).map(|_| build()).collect();
    black_box(&tables);
    let bytes = LIVE.load(Ordering::Relaxed) - before;
    drop(tables);
    assert_eq!(LIVE.load(Ordering::Relaxed), before, "Probe leaked retained allocation");
    bytes
}

fn main() {
    // usize has the same size as an owned origin pointer on this platform;
    // u8 models the one-byte grant/verdict enum. Origin objects themselves are
    // excluded equally. Include empty/large cases to expose tradeoffs.
    let count = 10_000;
    println!("kind,entries,tables,original_bytes,compact_bytes");
    for entries in [0, 1, 2, 3, 4, 5, 8, 9, 64] {
        let btree = measure(count, || {
            let mut map = BTreeMap::<usize, u8>::new();
            for key in 0..entries {
                map.insert(black_box(key), 1);
            }
            map
        });
        let compact = measure(count, || {
            let mut map = CompactMap::<usize, u8>::default();
            for key in 0..entries {
                map.insert(black_box(key), 1);
            }
            map
        });
        println!("origin_pointer_model,{entries},{count},{btree},{compact}");
        let hash = measure(count, || {
            let mut map = HashMap::<String, u8>::new();
            for key in 0..entries {
                map.insert(format!("scheme-{key}"), 1);
            }
            map
        });
        let compact = measure(count, || {
            let mut map = CompactMap::<Box<str>, u8>::default();
            for key in 0..entries {
                map.insert(format!("scheme-{key}").into(), 1);
            }
            map
        });
        println!("scheme_strings,{entries},{count},{hash},{compact}");
    }
}
