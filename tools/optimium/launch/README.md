# Rustinium memory-conscious launch

`rustinium.sh` is the launcher for the separately packaged Rust experiment.
Install it as `optimium` beside the real `Rustinium` executable and its runtime
resources. It intentionally retains the November 9 experimental profile and
`optimium-rust-origin.desktop` identity. Do not install it over the ordinary
Optimium launcher, which uses a different profile. No browser rebuild is needed.

The balanced default:

- Skips Chromium's bundled developer field-trial testing configuration. This
  non-Chrome-branded build otherwise applies `fieldtrial_testing_config.json`
  automatically. That configuration enables experimental WebUI toolbar controls
  and the organizer panel even when their compiled defaults are disabled.
  This switch does not disable every experiment or applicable variations seed.
- Creates top-chrome panels and renderers on demand instead of retaining a
  speculative WebUI preload, spare renderer, and search-engine prewarm.
- Uses the existing native omnibox suggestion popup. The WebUI popup, integrated
  AIM composer and independent full-WebUI popup are excluded. Ordinary URL,
  history and search suggestions still use the existing autocomplete controller.
- Retains both explicit Rust security-policy features, sandbox, site isolation,
  hardware acceleration, video settings, themes, and the user profile.

Tradeoffs: first-use navigation or a panel may need a renderer startup. Native
suggestions have different geometry and omit the integrated WebUI AI composer.
Skipping the testing config also stops its beneficial overrides; it is not a
claim of universal acceleration or equivalence to a stable Chrome release.

## Rollback

Fully exit this experimental browser, then run its installed launcher with:

```sh
RUSTINIUM_MEMORY_MODE=standard /path/to/package/optimium
```

This restores the previous launch behavior with the same profile. To restore it
permanently, replace the launcher with the saved original. Existing running
processes keep their original flags until a complete restart. Explicit command
line switch values are passed last and can replace whole switch values;
`--enable-features=X` alone cannot beat a matching disabled feature. Use standard
mode for a complete opt-out. A future packaging step must copy this launcher and
provide a real `Rustinium` executable, not only update a separate `chrome` file.

## Evidence, 2026-11-09

Same existing Linux binary, native Wayland/Niri windows on an isolated workspace,
clean temporary profiles, sandbox/GPU enabled. One identical local fixture:
1000 articles, 8000 retained JS records, 1 MiB array, eight images with 2,654,208
bytes of explicitly decoded retained pixels. Measurements taken 30 seconds after
navigation; workload-ready reports checked. These are browser-process-tree PSS
sums (shared mappings apportioned), excluding GPU VRAM. System pressure and other
applications can affect PSS; these short runs do not establish long-term leakage.

| Configuration | Run 1 loaded PSS | Run 2 loaded PSS | Processes |
|---|---:|---:|---:|
| Previous launcher behavior | 615.40 MiB | 624.59 MiB | 13 |
| Balanced launcher behavior | 463.19 MiB | 450.90 MiB | 9 |

Mean: 620.0 -> 457.0 MiB, approximately 26% lower for this local workload.
The main before/after runs used base/balanced/balanced/base order, with exploratory
preload/native-popup runs between the first baseline and first balanced run.
The intermediate preload-only result was 593.55 MiB; it was insufficient alone.

Navigation back succeeded in all four main runs. Tab Search opened on demand;
settings and new-tab page loaded. Focused native screenshots of the installed
launcher showed the existing appearance controls and custom home page. A first
inactive-workspace screenshot was stale and was not accepted as visual proof.
No claim is made about playback or fullscreen smoothness from these checks.

Fresh-profile YouTube navigation failed with `net::ERR_NAME_NOT_RESOLVED`, so its
memory measurement was rejected. The user's already-running browser was kept
open; savings on their authenticated YouTube page have not been measured.
Original launcher was backed up locally. No C++/Rust code or binary was changed.
