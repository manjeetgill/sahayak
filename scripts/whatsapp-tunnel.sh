#!/bin/sh
# Restore the existing pilot connection. Keep this process and Sahayak running.
# Both forwards bind only to loopback; no remote shell is opened.
set -eu
exec ssh -N \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ConnectTimeout=10 \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -i "$HOME/.ssh/id_ed25519_nralgo" \
  -R 127.0.0.1:44000:127.0.0.1:4000 \
  -L 127.0.0.1:4065:127.0.0.1:4060 \
  deploy@139.59.64.197
