#!/bin/bash
# GroupGuard One-Command Setup
#
# Usage: ./setup.sh
#
# Prerequisites: Node.js 20+, Docker

set -e

echo "=== GroupGuard Setup ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

ok() { echo -e "  ${GREEN}OK${NC} $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1"; exit 1; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# --- Step 1: Check Node.js ---
echo "Step 1: Checking Node.js..."
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js 20+ from https://nodejs.org"
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -lt 20 ]]; then
  fail "Node.js $NODE_VERSION found, but 20+ is required. Update from https://nodejs.org"
fi
ok "Node.js $(node -v)"

# --- Step 2: Check Docker ---
echo "Step 2: Checking Docker..."
if ! command -v docker &>/dev/null; then
  fail "Docker not found. Install Docker Desktop (macOS) or Docker Engine (Linux) from https://docker.com"
fi
if ! docker info &>/dev/null; then
  fail "Docker is not running. Start Docker Desktop (macOS) or run: sudo systemctl start docker (Linux)"
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# --- Step 3: Install dependencies ---
echo "Step 3: Installing dependencies..."
npm install --silent
ok "npm packages installed"

# --- Step 4: Build container image ---
echo "Step 4: Building container image..."
./container/build.sh
if docker run --rm --entrypoint echo groupguard-agent:latest "OK" &>/dev/null; then
  ok "Container image built and verified"
else
  fail "Container image build failed"
fi

# --- Step 5: WhatsApp authentication ---
echo "Step 5: WhatsApp authentication..."
if [[ -d "store/auth" ]] && [[ -f "store/auth/creds.json" ]]; then
  ok "Already authenticated (store/auth/ exists)"
else
  echo ""
  echo "  A QR code will appear. Scan it with your phone:"
  echo "  WhatsApp > Settings > Linked Devices > Link a Device"
  echo ""
  npm run auth
  echo ""
  ok "WhatsApp authenticated"
fi

# --- Step 6: Build TypeScript ---
echo "Step 6: Building TypeScript..."
npm run build --silent
ok "TypeScript compiled"

# --- Done ---
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Run GroupGuard with:"
echo "  npm run dev"
echo ""
echo "Other commands:"
echo "  npm run auth     - Re-authenticate WhatsApp"
echo "  npm run build    - Rebuild TypeScript"
echo ""
