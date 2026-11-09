# Experimental compact Rust security-policy tables

This step changes data layout in the existing Rust CPSP implementation. It does
not replace the browser engine or migrate additional C++ checks. The Rust
per-process origin/scheme grants and the inner per-BrowsingInstance V8/OAC maps
use `CompactMap`: sorted storage for up to four distinct keys, then a BTreeMap.
Outer maps, C++ fallback state, feature gating and process lifetime are retained.
Key comparisons still use `url::Origin`'s existing C++ ordering through CXX.

Scheme keys use `Box<str>` rather than capacity-bearing `String`. Repeated
scheme grants look up borrowed strings and avoid allocating another key.
Duplicate request grants cannot downgrade commit permissions; cached V8/OAC
values continue to preserve the first decision.

Large tables keep logarithmic lookup/insertion. Large scheme tables change from
average hash lookup to tree lookup; this is a memory/lookup-cost tradeoff.
Promotion has bounded transient allocations. The common small-table assumption
still needs browser workload measurements before claiming overall savings.

## Reproduce the isolated checks

From the Chromium source root, using the bundled Rust toolchain:

```sh
third_party/rust-toolchain/bin/rustc --edition=2024 --test \
  content/browser/security/cpsp/compact_map.rs -o /tmp/compact-map-tests
/tmp/compact-map-tests
third_party/rust-toolchain/bin/rustc --edition=2024 -O \
  tools/optimium/benchmark/compact_map_memory.rs -o /tmp/compact-map-memory
/tmp/compact-map-memory
```

The probe counts requested live heap bytes, including table objects in an outer
Vec. It does not measure RSS/PSS, allocator size classes, browser workload,
origin objects, or extra capacity of outer BTree nodes in the actual CPSP.
`usize/u8` models a pointer-sized origin key plus one-byte permission/verdict.
The separate scheme case compares the actual String/HashMap versus
Box<str>/CompactMap key/storage types with generated `scheme-N` strings.

Results on this Linux x86-64 toolchain, 10,000 maps per case, 2026-11-09:

| Entries per map | Origin model before / after (bytes) | Scheme before / after (bytes) |
|---|---:|---:|
| 0 | 240,000 / 320,000 | 480,000 / 320,000 |
| 1 | 1,360,000 / 480,000 | 2,100,000 / 640,000 |
| 2 | 1,360,000 / 640,000 | 2,240,000 / 960,000 |
| 3 | 1,360,000 / 960,000 | 2,380,000 / 1,520,000 |
| 4 | 1,360,000 / 960,000 | 3,840,000 / 1,600,000 |
| 5 | 1,360,000 / 1,440,000 | 3,980,000 / 2,720,000 |
| 8 | 1,360,000 / 1,440,000 | 7,040,000 / 2,960,000 |
| 64 | 12,400,000 / 12,480,000 | 51,840,000 / 24,940,000 |

The one-entry origin model uses about 65% less; the one-entry scheme case uses
about 70% less. This is NOT a browser-wide percentage. Empty or promoted former
BTree maps have an extra 8-byte table header; inner-map headers can also enlarge
outer BTree nodes. The threshold was reduced from eight to four after the probe
showed that eight-entry packed vectors cost more than the original BTree node.

## Validation and remaining checks

- Four standalone Rust tests passed: differential operations against BTreeMap,
  threshold/duplicate behavior, borrowed scheme lookup and permission upgrades,
  and exactly-once drops across promotion and duplicate inserts.
- Whole Rust CPSP crate metadata typecheck passed using the existing GN response
  file, original dependency artifacts, cfg and environment. No browser relink or
  installation was performed. Rust formatting and GN formatting checks passed.
- `RustCompactGrantTablesPreservePermissions` was added to the C++ parity suite,
  covering 32 fresh equivalent origins/schemes, upgrades, cross-process denial
  and missing/opaque origins. It has not been built or run in this step.
- Next authorized test build should run that test, existing Rust URL/pending-state
  parity tests and V8/OAC tests, then measure real browser PSS under identical
  YouTube/tab workloads. The current installed browser does not contain this code.
- Roll back this isolated commit to restore the old map layouts. Earlier Rust
  experiments, launcher settings and user profiles need no change.
