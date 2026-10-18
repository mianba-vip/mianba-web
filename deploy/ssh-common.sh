#!/usr/bin/env bash
# 由部署脚本 source；兼容 Git Bash / Linux / WSL。
SSH_HOST="${SSH_HOST:-106.14.143.151}"
SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${SSH_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
[[ -f "$SSH_KEY" ]] || { echo "SSH 私钥不存在：$SSH_KEY" >&2; exit 1; }
if [[ -x /c/Windows/System32/OpenSSH/ssh.exe ]]; then
  SSH_BIN=/c/Windows/System32/OpenSSH/ssh.exe
else
  SSH_BIN="$(command -v ssh)"
fi
if [[ "$SSH_BIN" == *.exe ]] && command -v cygpath >/dev/null; then
  SSH_KEY="$(cygpath -m "$SSH_KEY")"
fi
SSH=("$SSH_BIN" -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -p "$SSH_PORT")
REMOTE="$SSH_USER@$SSH_HOST"
