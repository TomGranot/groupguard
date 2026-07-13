#!/usr/bin/env bash
# GroupGuard guided setup
# Usage: ./setup.sh [--skip-auth] [--skip-groups]

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

ok() { printf "  ${GREEN}OK${NC}    %s\n" "$1"; }
info() { printf "  ${YELLOW}INFO${NC}  %s\n" "$1"; }
fail() { printf "  ${RED}FAIL${NC}  %s\n" "$1"; exit 1; }

SKIP_AUTH=false
SKIP_GROUPS=false
for argument in "$@"; do
  case "$argument" in
    --skip-auth) SKIP_AUTH=true ;;
    --skip-groups) SKIP_GROUPS=true ;;
    --help|-h)
      echo "Usage: ./setup.sh [--skip-auth] [--skip-groups]"
      exit 0
      ;;
    *) fail "Unknown option: $argument" ;;
  esac
done

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

printf "\n${BOLD}GroupGuard setup${NC}\n\n"
echo "GroupGuard uses WhatsApp's linked-device protocol because Meta's official API"
echo "does not support group moderation. WhatsApp may restrict automated accounts."
echo "Use a separate number that you can afford to lose."
echo ""
echo "Safe defaults in this setup:"
echo "  • observation only; no message deletion"
echo "  • AI agent and Docker disabled"
echo "  • moderation DMs disabled"
echo "  • bounded outbound actions and reconnects"
echo ""

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is missing. Install Node.js 20 or newer from https://nodejs.org"
fi
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js 20 or newer is required; found $(node --version)"
fi
ok "Node.js $(node --version)"

echo ""
info "Installing pinned dependencies"
npm ci --silent
ok "Dependencies installed"

if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env with safe defaults"
else
  ok "Preserved existing .env"
fi
if [ "$(uname -s)" != "MINGW" ]; then chmod 600 .env; fi

mkdir -p data store logs
if [ "$(uname -s)" != "MINGW" ]; then chmod 700 data store logs; fi

info "Building GroupGuard"
npm run build --silent
ok "TypeScript build passed"
npm test --silent
ok "Safety tests passed"

if [ "$SKIP_AUTH" = false ]; then
  if [ -f store/auth/creds.json ] && node -e "const c=require('./store/auth/creds.json');process.exit(c.registered?0:1)"; then
    ok "WhatsApp is already linked"
  else
    echo ""
    info "Linking WhatsApp. Pairing changes linked devices; it does not send messages."
    npm run auth
  fi
fi

if [ "$SKIP_GROUPS" = false ]; then
  if [ -t 0 ]; then
    npm run groups
  else
    info "No interactive terminal. Run npm run groups to choose groups."
  fi
fi

echo ""
if npm run doctor; then
  printf "${GREEN}${BOLD}Setup complete.${NC}\n\n"
  echo "Start GroupGuard: npm start"
  echo ""
  echo "Test locally first. For 24/7 use, move the same directory to a dedicated"
  echo "low-privilege VM. Keep observation mode on for at least one day before you"
  echo "consider enforcement. See docs/SAFE-OPERATIONS.md."
  echo ""
else
  fail "Setup needs attention. Fix the failed doctor checks, then run npm run doctor."
fi
