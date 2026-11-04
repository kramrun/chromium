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


def classify_process(argv, comm):
    """Classify without retaining command lines, which may contain URLs or secrets.

    Unknown is intentional: OS process names and Firefox's subprocess arguments
    differ between releases and cannot always be mapped reliably.
    """
    args = argv.replace(b'\0', b' ').decode('utf-8', 'replace').split()
    for arg in args:
        if arg.startswith('--type='):
            kind = arg.partition('=')[2]
            return {'gpu-process': 'gpu', 'renderer': 'renderer',
                    'utility': 'utility', 'zygote': 'zygote',
                    'broker': 'broker'}.get(kind, 'chromium:' + kind)
    name = comm.lower()
    if '-contentproc' in args:
        # Gecko's final argument indicates its subprocess type. The /proc comm
        # is more descriptive for web and extension content on Linux.
        if 'extension' in name:
            return 'extension'
        for token, kind in [('gpu', 'gpu'), ('socket', 'socket'),
                            ('rdd', 'media'), ('utility', 'utility'),
                            ('forkserver', 'forkserver'), ('tab', 'renderer')]:
            if args and args[-1].lower() == token:
                return kind
        if 'web content' in name or 'web co' in name:
            return 'renderer'
        return 'firefox:unknown-child'
    if name in ('firefox', 'firefox-bin', 'chrome', 'optimium'):
        return 'browser'
    return 'unknown'


def process_start(pid):
    # stat's parenthesized comm can contain spaces and parentheses.
    return int((Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()[19])


def sample(group):
    pids = set()
    for f in [group / 'cgroup.procs', *group.glob('**/cgroup.procs')]:
        try:
            pids.update(int(p) for p in f.read_text().split())
        except (OSError, ValueError):
            pass
    read = []
    missing = []
    details = []
    for pid in sorted(pids):
        try:
            proc = Path('/proc') / str(pid)
            start = process_start(pid)
            argv = (proc / 'cmdline').read_bytes()
            comm = (proc / 'comm').read_text().strip()
            lines = (proc / 'smaps_rollup').read_text().splitlines()
            values = {line.split(':', 1)[0]: int(line.split()[1]) for line in lines
                      if line.startswith(('Pss:', 'SwapPss:'))}
            entry = {'pid': pid, 'start_ticks': start,
                     'type': classify_process(argv, comm),
                     'pss_kib': values['Pss'], 'swap_pss_kib': values.get('SwapPss', 0)}
            if process_start(pid) != start:
                raise ValueError('Process identity changed during sampling')
            details.append(entry)
            read.append(pid)
        except (OSError, ValueError, KeyError, IndexError):
            missing.append(pid)
    by_type = {}
    for entry in details:
        total = by_type.setdefault(entry['type'], {'processes': 0, 'pss_kib': 0, 'swap_pss_kib': 0})
        total['processes'] += 1
        total['pss_kib'] += entry['pss_kib']
        total['swap_pss_kib'] += entry['swap_pss_kib']
    return {'pss_kib': sum(p['pss_kib'] for p in details),
            'swap_pss_kib': sum(p['swap_pss_kib'] for p in details),
            'processes_read': len(read), 'pids': read,
            'process_details': details, 'by_type': by_type,
            'unreadable_or_exited_pids': missing}


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
