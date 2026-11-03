Optimium / Firefox memory comparison on Linux

Requirements: Python 3 (standard library only), user systemd session,
Wayland desktop, readable /proc/PID/smaps_rollup, built Optimium and Firefox.
Run after compilation and other heavy tasks finish.

From the repository root:

  python3 tools/optimium/benchmark/run_pair.py --repeats 3

Defaults: out/Release/chrome and /usr/bin/firefox. Override them with
--optimium /absolute/browser/path and --firefox /absolute/browser/path.
Results and detailed logs go under out/optimium-benchmarks/results-TIMESTAMP.
Use --results-dir for another new directory. Existing results are not replaced.
Three repetitions take approximately 15 minutes; --repeats 1 gives a
preliminary snapshot in roughly five minutes. Browser order alternates.

One standalone scenario:

  python3 tools/optimium/benchmark/measure.py --browser optimium \
    --binary out/Release/chrome --tabs 10 --output /tmp/optimium-ten-tabs.json

Method

Each browser gets a new temporary profile and a separate systemd scope.
The harness launches 1 or 10 deterministic localhost pages. Each page retains
1000 DOM articles, a 1 MiB typed array, 8000 JavaScript objects and eight decoded
384x216 PNG images. Readiness beacons validate these counts for every tab;
heartbeat and process checks detect incomplete or interrupted runs.

PSS is summed over all processes in that browser's cgroup at 30, 40, 50 and
60 seconds after ALL tabs report ready. The summary uses the median of those
samples, then the median across repetitions. SwapPSS is reported separately.
An early exit, missing workload or unreadable live process fails the run.
Raw JSON includes PIDs, versions, launch flags, available RAM/swap, memory
pressure and server logs. The bundled browser_pss.py supplies the collector.

Browsers run in native Wayland windows with GPU and sandbox enabled. Firefox
onboarding is suppressed; memory-management defaults otherwise remain intact.
Fresh profiles contain no user-installed extensions or login sync; built-in
browser components retain their defaults. Existing personal profiles
and browser processes are not touched. Only the harness's unique scopes are
stopped; a temporary profile is deleted only after its scope is empty.

Limits

- This is one local origin and synthetic DOM/JS/image content. It does not
  establish performance on many unrelated websites, YouTube or video playback.
- Browser versions and default background services differ. Browser background
  services can use the network; workload assets only use the loopback server.
- PSS avoids double-counting shared resident mappings, but excludes GPU VRAM.
  SwapPSS and system memory pressure must be considered alongside resident PSS.
- One repetition is provisional. Other system activity, caches and memory
  pressure can change results; retain and report the raw samples.

This directory contains a reproducible method, not benchmark results.

Portal scope migration (schema 2): Chromium can move only its main process
into app-<application>-<PID>.scope for xdg-desktop-portal. The harness records
both the original scope and this verified sibling scope, summing all of their
processes exactly once. A root must match the exact temporary profile, browser
executable name and unchanged PID start time. Its PSS must be included in every
accepted sample. Missing roots, unexpected/shared scopes or new unread processes
fail validation. Both owned scopes are stopped before profile cleanup. Older
failed schema1 results that omitted the main process must not be compared.

Fixture v2 forces the same image decoding in every background tab without
changing either browser's throttling flags. After PNG load, synchronous canvas
drawImage/getImageData verifies a known pixel and retains 8 RGBA image buffers
(2,654,208 bytes per tab) in addition to the existing DOM, JS and image elements.
The readiness/heartbeat payload must include that full decoded byte count. This
avoids image.decode() waiting for a foreground rendering frame. Do not combine
v1 and v2 measurements: restart all1-tab and10-tab repetitions with v2.

Unattended Niri runs without touching the current desktop

Wrap the complete series with run_isolated.py. Example from repository root:

python3 tools/optimium/benchmark/run_isolated.py --record /tmp/optimium-isolation.json -- python3 tools/optimium/benchmark/run_pair.py --repeats 3

The wrapper backs up and validates the current Niri configuration, temporarily
adds one UUID-named workspace and one exact-app-id rule, and removes only its own
block afterward, preserving unrelated concurrent edits. Browser windows open
unfocused at1280x800 on that inactive workspace. Chromium uses --class and
Firefox uses --name to identify only the test windows. No personal browser
profile/window or global compositor opacity is changed. Niri IPC validates the
app-id, owning browser PID, geometry and inactive workspace before measurements;
a mismatch fails the run. Run the two browsers sequentially through one wrapper.

This is explicitly an INACTIVE-WINDOW workload: all tabs may be hidden, so
background scheduling follows each browser's ordinary defaults. Do not combine
these results with earlier visible-window runs. No headless browser mode or
software-rendering flag is used; rendering stays native Wayland/GPU. The wrapper
requires a live Niri session and leaves a metadata JSON and private config backup.
