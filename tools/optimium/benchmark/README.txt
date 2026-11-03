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
