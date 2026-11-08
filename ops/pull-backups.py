#!/usr/bin/env python3
"""Pull encrypted dumps over SSH. Run hourly on the owner's Mac via launchd."""
import argparse
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--host', required=True)
parser.add_argument('--identity', required=True)
parser.add_argument('--directory', required=True)
args = parser.parse_args()
os.umask(0o077)
directory = Path(args.directory).expanduser()
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
identity = str(Path(args.identity).expanduser())
options = ['-i', identity, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
           '-o', 'StrictHostKeyChecking=yes', '-o', 'ServerAliveInterval=15',
           '-o', 'ServerAliveCountMax=2']
result = subprocess.run(
    ['ssh', *options, args.host,
     "find /var/backups/train-club -maxdepth 1 -type f -name '*.dump.enc' -printf '%f\\n'"],
    check=True, capture_output=True, text=True, timeout=60,
)
names = sorted(result.stdout.splitlines())
if not names:
    raise SystemExit('No completed server backup found')
for name in names:
    if not re.fullmatch(r'\d{8}T\d{6}Z\.dump\.enc', name):
        raise SystemExit('Unexpected backup filename')
    destination = directory / name
    if destination.exists():
        continue
    partial = directory / (name + '.partial')
    subprocess.run(
        ['scp', *options, args.host + ':/var/backups/train-club/' + name, str(partial)],
        check=True, timeout=600,
    )
    if not partial.stat().st_size:
        raise SystemExit('Downloaded an empty backup')
    partial.replace(destination)
    print('Downloaded encrypted backup:', name, flush=True)
# Keep every downloaded copy on the Mac; server retention cannot delete them.
(directory / 'last-success.txt').write_text(names[-1] + '\n')
