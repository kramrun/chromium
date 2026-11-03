#!/usr/bin/env python3
"""Measure a fresh native browser only after every local fixture has loaded.

Uses the bundled Linux cgroup/PSS collector in browser_pss.py. Does not
touch user profiles, existing browser processes, or system browser defaults.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import signal
import statistics
import subprocess
import tempfile
import time
import uuid

import browser_pss as pss
from fixture import FixtureServer, SPEC


ORIGINAL = Path(__file__).resolve().parent / 'browser_pss.py'


def cgroup_pids(group):
    if not group or not group.exists():
        return []
    pids = set()
    for path in [group / 'cgroup.procs', *group.glob('**/cgroup.procs')]:
        try:
            pids.update(map(int, path.read_text().split()))
        except (OSError, ValueError):
            pass
    return sorted(pids)


def system_state():
    result = {'load_average': list(os.getloadavg())}
    values = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        if key in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'):
            values[key + '_kib'] = int(value.split()[0])
    result['memory'] = values
    try:
        result['memory_pressure'] = Path('/proc/pressure/memory').read_text().strip()
    except OSError:
        pass
    return result


def process_start(pid):
    # Field 22; the command field may itself contain spaces or parentheses.
    return int(Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19])


def profile_roots(profile):
    token = os.fsencode(profile)
    roots = {}
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            pid = int(path.name)
            start = process_start(pid)
            # Chromium rewrites its process title into one space-joined argv
            # string. The generated /tmp profile has no whitespace; use exact
            # argument tokens, and /proc/exe to reject systemd-run's own argv.
            argv = (path / 'cmdline').read_bytes().replace(b'\0', b' ').split()
            if not argv or (path / 'exe').resolve().name not in (
                    'chrome', 'optimium', 'firefox', 'firefox-bin'):
                continue
            exact_profile = (b'--user-data-dir=' + token in argv or any(
                arg in (b'--profile', b'-profile') and argv[index + 1] == token
                for index, arg in enumerate(argv[:-1])))
            child = (any(arg.startswith(b'--type=') for arg in argv)
                     or b'-contentproc' in argv)
            if not exact_profile or child or process_start(pid) != start:
                continue
            group = next(line[3:] for line in (path / 'cgroup').read_text().splitlines()
                         if line.startswith('0::'))
            roots[pid] = {'pid': pid, 'start_ticks': start,
                          'cgroup': str(Path('/sys/fs/cgroup') / group.lstrip('/'))}
        except (OSError, ValueError, IndexError, StopIteration):
            continue
    return roots


class BrowserScopes:
    """Follow a portal's root-only scope migration without losing descendants.

    Chromium's xdg portal registration moves its main process into an app scope,
    leaving already-launched children in the original scope. Both are measured.
    Accept only sibling app scopes explicitly containing our exact-profile root;
    retain the cgroup inode and PID start time to reject reuse/foreign processes.
    """
    def __init__(self, group, profile):
        self.original = group
        self.profile = profile
        self.groups = {}
        self.root_identities = {}
        self.bind_roots = False
        self.refresh()

    def refresh(self):
        roots = profile_roots(self.profile)
        for pid, root in roots.items():
            if self.bind_roots and self.root_identities.get(pid) != root['start_ticks']:
                raise RuntimeError('Browser root identity changed during measurement')
            self.root_identities.setdefault(pid, root['start_ticks'])
            group = Path(root['cgroup'])
            if group != self.original and not (
                    group.parent == self.original.parent
                    and group.name.startswith('app-')
                    and group.name.endswith(f'-{pid}.scope')):
                raise RuntimeError('Browser migrated to an unexpected/shared cgroup')
            self._remember(group)
        self._remember(self.original)
        return roots

    def _remember(self, group):
        try:
            inode = group.stat().st_ino
        except FileNotFoundError:
            return
        if group in self.groups and self.groups[group] != inode:
            raise RuntimeError('Browser cgroup was replaced during measurement')
        self.groups[group] = inode

    def live_groups(self):
        result = []
        for group, inode in self.groups.items():
            try:
                if group.stat().st_ino != inode:
                    raise RuntimeError('Refusing a reused browser cgroup')
                result.append(group)
            except FileNotFoundError:
                pass
        return result

    def pids(self):
        return sorted({pid for group in self.live_groups() for pid in cgroup_pids(group)})


def collect(scopes, server):
    roots = scopes.refresh()
    groups = scopes.live_groups()
    samples = [pss.sample(group) for group in groups]
    # All accepted groups are siblings; assert no double counting nevertheless.
    pids = [pid for item in samples for pid in item['pids']]
    if len(pids) != len(set(pids)):
        raise RuntimeError('A process moved between scopes while sampling; retry run')
    missing = [pid for item in samples for pid in item['unreadable_or_exited_pids']]
    item = {'pss_kib': sum(s['pss_kib'] for s in samples),
            'swap_pss_kib': sum(s['swap_pss_kib'] for s in samples),
            'processes_read': len(pids), 'pids': sorted(pids),
            'unreadable_or_exited_pids': missing,
            'cgroups': [str(group) for group in groups]}
    live_missing = [pid for pid in missing if Path(f'/proc/{pid}').exists()]
    fixture = server.snapshot()
    roots_after = scopes.refresh()
    root_pids = sorted(pid for pid, root in roots.items()
                       if roots_after.get(pid) == root and pid in pids)
    # A process created while /proc was read must not be silently omitted.
    newly_unread = sorted(set(scopes.pids()) - set(pids))
    ages = fixture['heartbeat_age_seconds'].values()
    item.update({
        'unreadable_live_pids': live_missing,
        'new_or_unread_pids': newly_unread,
        'profile_process_pids': root_pids,
        'browser_roots': list(roots.values()),
        'fixture': fixture,
        'complete': (item['processes_read'] >= 2 and not live_missing
                     and not newly_unread and len(root_pids) == 1
                     and len(fixture['ready_tabs']) == server.tabs
                     and not fixture['failures'] and all(age <= 60 for age in ages)),
        'system': system_state(),
    })
    return item


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', choices=['optimium', 'firefox'], required=True)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--tabs', type=int, choices=[1, 10], required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--sample-seconds', default='30,40,50,60',
                        help='Seconds after ALL fixtures report ready')
    parser.add_argument('--ready-timeout', type=float, default=120)
    args = parser.parse_args()
    try:
        times = sorted(set(float(value) for value in args.sample_seconds.split(',')))
    except ValueError:
        parser.error('Invalid sample times')
    if not times or times[0] < 1:
        parser.error('Sample times must be positive')
    binary = shutil.which(args.binary)
    if not binary:
        parser.error('Browser binary does not exist')
    output = Path(args.output).resolve()
    if output.exists():
        parser.error('Result exists; use a new output path')
    output.parent.mkdir(parents=True, exist_ok=True)
    browser_log_path = output.with_suffix('.browser.log')
    server_log_path = output.with_suffix('.server.jsonl')
    if browser_log_path.exists() or server_log_path.exists():
        parser.error('Log paths exist; use a new output path')

    profile = Path(tempfile.mkdtemp(prefix='optimium-memory-fixture-', dir='/tmp'))
    unit = 'optimium-memory-' + uuid.uuid4().hex + '.scope'
    version = subprocess.run([binary, '--version'], capture_output=True,
                             text=True, timeout=15)
    result = {
        'schema': 2, 'status': 'running', 'complete': False,
        'started_utc': datetime.now(timezone.utc).isoformat(),
        'browser': args.browser, 'binary': str(Path(binary).resolve()),
        'version': version.stdout.strip() or version.stderr.strip(),
        'tabs': args.tabs, 'workload': SPEC,
        'mode': 'native Wayland with GPU enabled; clean profile; no user-installed extensions',
        'sample_seconds_after_all_tabs_ready': times,
        'unit': unit, 'temporary_profile': str(profile),
        'samples': [], 'warnings': [], 'collector_source': str(ORIGINAL),
        'initial_system': system_state(),
    }
    server = None
    runner = None
    log = None
    group = None
    scopes = None
    failure = None
    try:
        if args.browser == 'firefox':
            # Suppress onboarding, not rendering features, caches, process
            # isolation, tab unloading or memory-management defaults.
            prefs = {
                'browser.shell.checkDefaultBrowser': False,
                'browser.aboutwelcome.enabled': False,
                'browser.startup.homepage_override.mstone': 'ignore',
                'browser.startup.firstrunSkipsHomepage': True,
            }
            (profile / 'user.js').write_text(''.join(
                f'user_pref({json.dumps(key)}, {json.dumps(value)});\n'
                for key, value in prefs.items()))
            result['profile_overrides'] = prefs
            flags = ['--no-remote', '--profile', str(profile)]
        else:
            result['profile_overrides'] = {}
            flags = ['--user-data-dir=' + str(profile), '--no-first-run',
                     '--no-default-browser-check', '--ozone-platform=wayland']
        server = FixtureServer(args.tabs, server_log_path)
        urls = server.urls()
        result['urls'] = urls
        result['browser_arguments'] = flags
        result['logs'] = {'browser': str(browser_log_path), 'server': str(server_log_path)}
        log = browser_log_path.open('x', encoding='utf-8')
        environment = os.environ.copy()
        environment['MOZ_ENABLE_WAYLAND'] = '1'
        runner = subprocess.Popen(
            ['systemd-run', '--user', '--scope', '--quiet', '--unit', unit, '--',
             binary, *flags, *urls], stdout=log, stderr=log, env=environment)
        launched = time.monotonic()
        while time.monotonic() - launched < 15:
            group = pss.cgroup_path(unit)
            if group and cgroup_pids(group):
                break
            if runner.poll() is not None:
                raise RuntimeError('Scope launch exited before a browser appeared; see browser log')
            time.sleep(.1)
        else:
            raise RuntimeError('No isolated cgroup appeared')
        result['cgroup'] = str(group)
        scopes = BrowserScopes(group, profile)

        while time.monotonic() - launched < args.ready_timeout:
            snapshot = server.snapshot()
            if snapshot['failures']:
                raise RuntimeError('Fixture reported an incomplete/failed workload')
            if len(snapshot['ready_tabs']) == args.tabs:
                break
            if not scopes.refresh() and not scopes.pids():
                raise RuntimeError('Browser exited before fixtures loaded')
            time.sleep(.25)
        else:
            raise RuntimeError(f'Only {len(snapshot["ready_tabs"])}/{args.tabs} fixtures loaded')
        if len(scopes.refresh()) != 1:
            result['unexpected_roots'] = scopes.refresh()
            raise RuntimeError('Expected exactly one live browser root for this profile: ' + repr(result['unexpected_roots']))
        scopes.bind_roots = True
        ready = time.monotonic()
        result['all_tabs_ready_seconds_after_launch'] = round(ready-launched, 3)
        print(f'{args.browser}: {args.tabs}/{args.tabs} fixtures ready', flush=True)

        for expected in times:
            while time.monotonic() - ready < expected:
                if not scopes.refresh():
                    raise RuntimeError('Browser exited before the measurement completed')
                time.sleep(min(.5, max(0, expected - (time.monotonic() - ready))))
            retries = []
            for attempt in range(3):
                item = collect(scopes, server)
                if item['complete'] or not item['new_or_unread_pids'] or attempt == 2:
                    break
                # Process creation during a /proc walk invalidates that snapshot.
                # Retry the ENTIRE sample, retaining rejected evidence; never
                # silently drop the new process or reuse the partial PSS total.
                retries.append(item)
                time.sleep(.1)
            if retries:
                item['rejected_transient_samples'] = retries
            item['seconds_after_all_tabs_ready'] = round(time.monotonic() - ready, 3)
            item['seconds_after_launch'] = round(time.monotonic() - launched, 3)
            result['samples'].append(item)
            print(f'{args.browser} {args.tabs} tabs +{expected:g}s: '
                  f'PSS={item["pss_kib"]/1024:.1f} MiB '
                  f'SwapPSS={item["swap_pss_kib"]/1024:.1f} MiB '
                  f'processes={item["processes_read"]} complete={item["complete"]}', flush=True)
            if not item['complete']:
                raise RuntimeError('Sample incomplete: missing processes or fixture liveness')
        result['complete'] = len(result['samples']) == len(times)
        result['status'] = 'complete'
        result['summary'] = {
            'median_pss_mib': round(statistics.median(s['pss_kib'] for s in result['samples'])/1024, 3),
            'median_swap_pss_mib': round(statistics.median(s['swap_pss_kib'] for s in result['samples'])/1024, 3),
            'min_pss_mib': round(min(s['pss_kib'] for s in result['samples'])/1024, 3),
            'max_pss_mib': round(max(s['pss_kib'] for s in result['samples'])/1024, 3),
        }
    except BaseException as error:
        failure = error
        result['status'] = 'failed'
        result['complete'] = False
        result['error'] = f'{type(error).__name__}: {error}'
    finally:
        if server:
            result['final_fixture'] = server.snapshot()
        if runner:
            if scopes:
                # Refresh while the root is alive so its portal-created scope
                # is also stopped; never remove an active browser's profile.
                try:
                    scopes.refresh()
                except RuntimeError as error:
                    result['warnings'].append('Cleanup scope verification: ' + str(error))
                result['tracked_cgroups'] = [str(g) for g in scopes.live_groups()]
                result['scope_stop_exit_codes'] = {
                    g.name: pss.systemctl('stop', g.name).returncode
                    for g in scopes.live_groups() if g != group}
            # A startup failure can precede scope registration. Terminate only
            # roots still bound to this exact temporary profile; pidfd avoids
            # signalling a reused PID. This never stops a shared foreign scope.
            result['cleanup_root_signals'] = []
            for pid, root in profile_roots(profile).items():
                try:
                    fd = os.pidfd_open(pid)
                    try:
                        if process_start(pid) == root['start_ticks']:
                            signal.pidfd_send_signal(fd, signal.SIGTERM)
                            result['cleanup_root_signals'].append(pid)
                    finally:
                        os.close(fd)
                except ProcessLookupError:
                    pass
            result['scope_stop_exit_code'] = pss.systemctl('stop', unit).returncode
            try:
                runner.wait(timeout=15)
            except subprocess.TimeoutExpired:
                runner.terminate()
                result['warnings'].append('Scope command did not exit promptly')
        remaining = sorted(set(scopes.pids() if scopes else cgroup_pids(group))
                           | set(profile_roots(profile)))
        if remaining:
            result['warnings'].append('Scope still populated; temporary profile retained')
            result['remaining_pids'] = remaining
        else:
            shutil.rmtree(profile)
        if log:
            log.close()
        if server:
            server.close()
        result['final_system'] = system_state()
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    if failure:
        print(f'FAILED: {failure}. Details: {output}', flush=True)
        return 1
    print(f'Result: {output}', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
