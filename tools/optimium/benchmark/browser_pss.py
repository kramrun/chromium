#!/usr/bin/env python3
"""Measure an isolated browser instance's resident proportional memory on Linux."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import uuid


def systemctl(*args):
    return subprocess.run(['systemctl', '--user', *args], text=True, capture_output=True)


def cgroup_path(unit):
    result = systemctl('show', unit, '--property=ControlGroup', '--value')
    group = result.stdout.strip()
    if result.returncode or not group or not group.startswith('/user.slice/'):
        return None
    return Path('/sys/fs/cgroup') / group.lstrip('/')


def sample(group):
    pids = set()
    for f in [group / 'cgroup.procs', *group.glob('**/cgroup.procs')]:
        try:
            pids.update(int(p) for p in f.read_text().split())
        except (OSError, ValueError):
            pass
    pss = swap = 0
    read = []
    missing = []
    for pid in sorted(pids):
        try:
            lines = (Path('/proc') / str(pid) / 'smaps_rollup').read_text().splitlines()
            values = {line.split(':', 1)[0]: int(line.split()[1]) for line in lines
                      if line.startswith(('Pss:', 'SwapPss:'))}
            pss += values['Pss']
            swap += values.get('SwapPss', 0)
            read.append(pid)
        except (OSError, ValueError, KeyError, IndexError):
            missing.append(pid)
    return {'pss_kib': pss, 'swap_pss_kib': swap, 'processes_read': len(read),
            'pids': read, 'unreadable_or_exited_pids': missing}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--browser', required=True, choices=['firefox', 'chromium'])
    ap.add_argument('--binary', required=True, help='Browser executable, e.g. /usr/bin/firefox')
    ap.add_argument('--seconds', type=int, default=120)
    ap.add_argument('--interval', type=int, default=10)
    ap.add_argument('--output', required=True, help='JSON output file, must not already exist')
    ap.add_argument('urls', nargs='*', default=['about:blank'])
    args = ap.parse_args()
    binary = shutil.which(args.binary)
    if not binary or args.seconds < 1 or args.interval < 1:
        ap.error('Executable must exist and seconds/interval must be positive')
    if Path(args.output).exists():
        ap.error('Output already exists; choose a new file')
    if not all(u.startswith(('https://', 'http://', 'about:blank')) for u in args.urls):
        ap.error('Only HTTP(S) URLs and about:blank are allowed')
    profile = tempfile.mkdtemp(prefix='codex-browser-pss-')
    unit = 'codex-browser-pss-' + uuid.uuid4().hex + '.scope'
    flags = (['--no-remote', '--profile', profile] if args.browser == 'firefox'
             else ['--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check'])
    cmd = [binary, *flags, *(args.urls or ['about:blank'])]
    runner = subprocess.Popen(['systemd-run', '--user', '--scope', '--quiet', '--unit', unit, '--', *cmd],
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    result = {'browser': args.browser, 'binary': binary, 'urls': args.urls or ['about:blank'],
              'unit': unit, 'profile': profile, 'samples': [], 'warnings': []}
    group = None
    try:
        for _ in range(100):
            group = cgroup_path(unit)
            if group and group.exists():
                break
            if runner.poll() is not None:
                raise RuntimeError('Unable to start isolated scope: ' + runner.stderr.read()[-1000:])
            time.sleep(.1)
        else:
            raise RuntimeError('Timed out waiting for isolated cgroup')
        start = time.monotonic()
        while True:
            elapsed = time.monotonic() - start
            item = sample(group)
            item['seconds'] = round(elapsed, 2)
            result['samples'].append(item)
            print(f"{elapsed:.1f}s: PSS {item['pss_kib']/1024:.1f} MiB; swap PSS {item['swap_pss_kib']/1024:.1f} MiB; processes {item['processes_read']}", flush=True)
            if item['unreadable_or_exited_pids']:
                result['warnings'].append('Some processes exited or were unreadable while sampling')
            if runner.poll() is not None or elapsed >= args.seconds:
                break
            time.sleep(min(args.interval, max(0, args.seconds - elapsed)))
    finally:
        stopped = systemctl('stop', unit)
        try:
            runner.wait(timeout=10)
        except subprocess.TimeoutExpired:
            runner.terminate()
            result['warnings'].append('Scope runner did not exit promptly')
        # Never delete a profile while the scope still contains processes.
        group = cgroup_path(unit)
        if group and group.exists() and sample(group)['processes_read']:
            result['warnings'].append('Scope still active; temporary profile retained')
        else:
            shutil.rmtree(profile, ignore_errors=True)
        result['scope_stop_exit_code'] = stopped.returncode
        with open(args.output, 'x', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    if not result['samples'] or max(s['processes_read'] for s in result['samples']) < 2:
        raise RuntimeError('Fewer than two processes observed: check that the browser actually launched inside the scope')


if __name__ == '__main__':
    main()
