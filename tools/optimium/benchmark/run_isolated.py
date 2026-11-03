#!/usr/bin/env python3
"""Run a benchmark command on a temporary, unfocused Niri workspace.

Usage: python3 run_isolated.py -- python3 run_pair.py --repeats 3
Only this UUID's workspace/rule is added, validated, then removed. Existing
browser windows, focus, compositor opacity and browser rendering flags stay as-is.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid


def ipc(command):
    return json.loads(subprocess.check_output(['niri', 'msg', '-j', command], text=True))


def replace_config(path, expected, replacement):
    handle, candidate = tempfile.mkstemp(prefix='.optimium-benchmark-', suffix='.kdl',
                                         dir=path.parent)
    temporary = Path(candidate)
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(replacement)
        shutil.copymode(path, temporary)
        subprocess.run(['niri', 'validate', '--config', str(temporary)], check=True,
                       capture_output=True, text=True)
        if path.read_bytes() != expected:
            raise RuntimeError('Niri config changed concurrently; not overwriting it')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=os.environ.get(
        'NIRI_CONFIG', str(Path.home() / '.config/niri/config.kdl')))
    parser.add_argument('--record', required=True, help='New JSON isolation metadata path')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('Supply a benchmark command after --')
    record = Path(args.record).resolve()
    if record.exists():
        parser.error('Record exists; use a new path')
    record.parent.mkdir(parents=True, exist_ok=True)
    config = Path(args.config).expanduser().resolve()
    original = config.read_bytes()
    identity = 'optimium-memory-' + uuid.uuid4().hex
    output = ipc('focused-output')['name']
    focus_before = ipc('focused-window')
    block = (f'\n// BEGIN {identity}\n'
             f'workspace "{identity}" {{ open-on-output {json.dumps(output)}; }}\n'
             'window-rule {\n'
             f'    match app-id="^{identity}$"\n'
             f'    open-on-workspace "{identity}"\n'
             '    open-focused false\n'
             '    open-floating true\n'
             '    default-column-width { fixed 1280; }\n'
             '    default-window-height { fixed 800; }\n'
             '}\n'
             f'// END {identity}\n').encode()
    backup = record.with_suffix('.config-backup.kdl')
    with backup.open('xb') as stream:
        os.chmod(backup, 0o600)
        stream.write(original)
    metadata = {'identity': identity, 'config': str(config), 'backup': str(backup),
                'output': output, 'focus_before': focus_before, 'command': command,
                'mode': 'native Wayland; separate inactive workspace;1280x800 windows',
                'rule_removed': False}
    installed = False
    try:
        replace_config(config, original, original + block)
        installed = True
        for _ in range(40):
            if any(ws['name'] == identity for ws in ipc('workspaces')):
                break
            time.sleep(.1)
        else:
            raise RuntimeError('Niri did not create the isolated workspace')
        # Newly declared workspaces start at index1. Move only this workspace
        # to the end without focusing it, retaining the user's usual indices.
        spaces = ipc('workspaces')
        last_index = max(ws['idx'] for ws in spaces if ws['output'] == output)
        subprocess.run(['niri', 'msg', 'action', 'move-workspace-to-index',
                        '--reference', identity, str(last_index)], check=True,
                       capture_output=True, text=True)
        metadata['workspace_after_placement'] = next(
            ws for ws in ipc('workspaces') if ws['name'] == identity)
        env = os.environ.copy()
        env['OPTIMIUM_BENCHMARK_APP_ID'] = identity
        env['OPTIMIUM_BENCHMARK_WORKSPACE'] = identity
        env['CHROME_DESKTOP'] = identity + '.desktop'
        child = subprocess.run(command, env=env)
        metadata['exit_code'] = child.returncode
        return child.returncode
    finally:
        if installed:
            current = config.read_bytes()
            if current.count(block) != 1:
                metadata['cleanup_error'] = 'Rule changed externally; not overwriting user config'
            else:
                replace_config(config, current, current.replace(block, b'', 1))
                metadata['rule_removed'] = True
        metadata['focus_after'] = ipc('focused-window')
        metadata['remaining_test_windows'] = [w for w in ipc('windows')
                                               if w['app_id'] == identity]
        record.write_text(json.dumps(metadata, indent=2) + '\n')
        print('Isolation record:', record, flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
