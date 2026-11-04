#!/usr/bin/env python3
"""Run 1/10-tab native Optimium and Firefox measurements sequentially."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import statistics
import subprocess
import sys
import time


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--optimium', default=str(
        REPO_ROOT / 'out/Release/chrome'))
    parser.add_argument('--firefox', default='/usr/bin/firefox')
    parser.add_argument('--repeats', type=int, default=1)
    parser.add_argument('--cooldown', type=float, default=10)
    parser.add_argument('--results-dir', default=str(
        REPO_ROOT / 'out/optimium-benchmarks' / ('results-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%SZ'))))
    args = parser.parse_args()
    if args.repeats < 1 or args.cooldown < 0:
        parser.error('Invalid repetitions or cooldown')
    folder = Path(args.results_dir).resolve()
    if folder.exists():
        parser.error('Results directory exists; select a new one')
    folder.mkdir(parents=True)
    runs = []
    for repeat in range(args.repeats):
        order = ['optimium', 'firefox'] if repeat % 2 == 0 else ['firefox', 'optimium']
        for tabs in (1, 10):
            for browser in order:
                output = folder / f'{browser}-{tabs}tabs-run{repeat+1}.json'
                cmd = [sys.executable, str(HERE / 'measure.py'), '--browser', browser,
                       '--binary', getattr(args, browser), '--tabs', str(tabs),
                       '--output', str(output)]
                print(f'Run {repeat+1}/{args.repeats}: {browser}, {tabs} tabs', flush=True)
                completed = subprocess.run(cmd)
                if completed.returncode:
                    print(f'Benchmark stopped; incomplete data in {output}', flush=True)
                    return completed.returncode
                run = json.loads(output.read_text())
                if not run.get('complete'):
                    print('Incomplete run cannot be compared', flush=True)
                    return 1
                runs.append({'file': str(output), 'browser': browser, 'tabs': tabs,
                             'version': run['version'], 'summary': run['summary']})
                if args.cooldown:
                    time.sleep(args.cooldown)
    comparison = []
    for tabs in (1, 10):
        pair = {'tabs': tabs}
        for browser in ('optimium', 'firefox'):
            selected = [r for r in runs if r['browser'] == browser and r['tabs'] == tabs]
            pair[browser] = {
                'runs': len(selected),
                'median_pss_mib': statistics.median(r['summary']['median_pss_mib'] for r in selected),
                'median_swap_pss_mib': statistics.median(r['summary']['median_swap_pss_mib'] for r in selected),
            }
        pair['optimium_pss_relative_to_firefox_percent'] = round(
            100 * pair['optimium']['median_pss_mib'] / pair['firefox']['median_pss_mib'], 2)
        comparison.append(pair)
    report = {
        'status': 'complete', 'runs': runs, 'comparison': comparison,
        'method': 'Median of PSS samples at 30/40/50/60 seconds after all tabs report ready; then median across repetitions.',
        'limitations': [
            'Synthetic DOM/JS/image workload served from one localhost origin, not YouTube or a representative browsing session.',
            'Browser versions and default background services differ; no account sync or user extensions are included.',
            'PSS measures proportional resident memory; SwapPSS is reported separately. GPU VRAM is not included.',
            'Operating-system activity and memory pressure can affect results. Avoid compiling concurrently.',
            'One repetition is a preliminary snapshot; three repetitions are recommended for a steadier comparison.',
        ],
    }
    summary = folder / 'comparison.json'
    summary.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(comparison, indent=2), flush=True)
    print(f'Comparison: {summary}', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
