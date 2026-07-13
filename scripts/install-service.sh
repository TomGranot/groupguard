#!/usr/bin/env bash
# Install GroupGuard as a per-user service on Linux or macOS.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_PATH="$(command -v node)"
HOME_DIR="${HOME:?HOME is required}"

cd "$PROJECT_ROOT"
npm run doctor
npm run build
mkdir -p logs

escape_sed() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

ROOT_ESCAPED="$(escape_sed "$PROJECT_ROOT")"
NODE_ESCAPED="$(escape_sed "$NODE_PATH")"
HOME_ESCAPED="$(escape_sed "$HOME_DIR")"

case "$(uname -s)" in
  Linux)
    SERVICE_DIR="$HOME_DIR/.config/systemd/user"
    SERVICE_PATH="$SERVICE_DIR/groupguard.service"
    mkdir -p "$SERVICE_DIR"
    sed \
      -e "s|{{PROJECT_ROOT}}|$ROOT_ESCAPED|g" \
      -e "s|{{NODE_PATH}}|$NODE_ESCAPED|g" \
      systemd/groupguard.service > "$SERVICE_PATH"
    systemctl --user daemon-reload
    systemctl --user enable --now groupguard
    echo "GroupGuard service installed and started."
    echo "Status: systemctl --user status groupguard"
    echo "For startup without an interactive login, ask your host to enable user lingering."
    ;;
  Darwin)
    SERVICE_DIR="$HOME_DIR/Library/LaunchAgents"
    SERVICE_PATH="$SERVICE_DIR/com.groupguard.plist"
    mkdir -p "$SERVICE_DIR"
    sed \
      -e "s|{{PROJECT_ROOT}}|$ROOT_ESCAPED|g" \
      -e "s|{{NODE_PATH}}|$NODE_ESCAPED|g" \
      -e "s|{{HOME}}|$HOME_ESCAPED|g" \
      launchd/com.groupguard.plist > "$SERVICE_PATH"
    launchctl bootout "gui/$UID/com.groupguard" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$SERVICE_PATH"
    echo "GroupGuard service installed and started."
    echo "Status: launchctl print gui/$UID/com.groupguard"
    ;;
  *)
    echo "Automatic service installation supports Linux and macOS."
    exit 1
    ;;
esac
