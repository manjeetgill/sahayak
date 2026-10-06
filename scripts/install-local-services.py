"""Install restartable macOS login services for the existing local Sahayak pilot."""
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

root = Path(__file__).resolve().parent.parent
pnpm = shutil.which('pnpm')
node = shutil.which('node')
if not pnpm or not node:
    raise SystemExit('Install Node and pnpm first')
services = {
    'api': [pnpm, 'dev:api'],
    'web': [pnpm, 'dev:web'],
    'whatsapp-tunnel': ['/usr/bin/ssh', '-N', '-o', 'BatchMode=yes',
        '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
        '-i', str(Path.home() / '.ssh/id_ed25519_nralgo'),
        '-R', '127.0.0.1:44000:127.0.0.1:4000',
        '-L', '127.0.0.1:4065:127.0.0.1:4060', 'deploy@139.59.64.197'],
}
agent_dir = Path.home() / 'Library/LaunchAgents'
log_dir = Path.home() / 'Library/Logs/Sahayak'
agent_dir.mkdir(parents=True, exist_ok=True)
log_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(log_dir, 0o700)
domain = f'gui/{os.getuid()}'
for name, command in services.items():
    if os.environ.get('SAHAYAK_SERVICE') and os.environ['SAHAYAK_SERVICE'] != name:
        continue
    label = f'in.sahayak.local.{name}'
    path = agent_dir / f'{label}.plist'
    config = {
        'Label': label, 'ProgramArguments': command,
        'WorkingDirectory': str(Path.home() if name == 'whatsapp-tunnel' else root),
        'EnvironmentVariables': {'PATH': str(Path(node).parent) + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': str(Path.home())},
        'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
        'ProcessType': 'Background', 'Umask': 0o077,
        'StandardOutPath': str(log_dir / f'{name}.log'),
        'StandardErrorPath': str(log_dir / f'{name}.error.log'),
    }
    path.write_bytes(plistlib.dumps(config))
    os.chmod(path, 0o600)
    subprocess.run(['launchctl', 'bootout', f'{domain}/{label}'], capture_output=True)
    subprocess.run(['launchctl', 'bootstrap', domain, str(path)], check=True)
    print(f'Started {label}')
print('Services restart after exit and start at login. Mac sleep or shutdown still interrupts this local pilot.')
