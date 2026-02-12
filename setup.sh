#!/bin/bash
# GroupGuard / NanoClaw One-Command Setup
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
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ok() { echo -e "  ${GREEN}OK${NC} $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1"; exit 1; }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; }

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
  fail "Docker not found. Install from https://docker.com/products/docker-desktop"
fi

if ! docker info &>/dev/null; then
  fail "Docker is not running. Start Docker Desktop (macOS) or run 'sudo systemctl start docker' (Linux)"
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# --- Step 3: Install dependencies ---
echo "Step 3: Installing dependencies..."
npm install --silent
ok "npm packages installed"

# --- Step 4: Build container image ---
echo "Step 4: Building container image..."
./container/build.sh
if docker run --rm --entrypoint echo nanoclaw-agent:latest "OK" &>/dev/null; then
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

# --- Step 7: Install service ---
echo "Step 7: Installing service..."

OS="$(uname -s)"
case "$OS" in
  Darwin)
    echo "  Detected: macOS"

    # Generate launchd plist
    NODE_PATH=$(which node)
    HOME_PATH="$HOME"

    cat > ~/Library/LaunchAgents/com.nanoclaw.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${PROJECT_ROOT}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_ROOT}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME_PATH}/.local/bin</string>
        <key>HOME</key>
        <string>${HOME_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${PROJECT_ROOT}/logs/nanoclaw.log</string>
    <key>StandardErrorPath</key>
    <string>${PROJECT_ROOT}/logs/nanoclaw.error.log</string>
</dict>
</plist>
EOF

    mkdir -p logs
    launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist 2>/dev/null || true
    ok "launchd service installed and started"

    # Check if Docker Desktop handles networking
    if ! docker info 2>/dev/null | grep -q "Desktop"; then
      warn "Non-Desktop Docker detected. You may need to run: sudo ./scripts/macos-networking.sh"
    fi
    ;;

  Linux)
    echo "  Detected: Linux"

    # Generate systemd service from template
    SERVICE_FILE="/tmp/groupguard.service"
    sed -e "s|{{PROJECT_ROOT}}|${PROJECT_ROOT}|g" \
        -e "s|{{USER}}|$(whoami)|g" \
        "$PROJECT_ROOT/systemd/groupguard.service" > "$SERVICE_FILE"

    echo "  Installing systemd service (requires sudo)..."
    sudo cp "$SERVICE_FILE" /etc/systemd/system/groupguard.service
    sudo systemctl daemon-reload
    sudo systemctl enable groupguard
    sudo systemctl start groupguard
    rm -f "$SERVICE_FILE"
    ok "systemd service installed and started"
    ;;

  *)
    warn "Unknown OS: $OS. Service not installed. Run manually with: npm run start"
    ;;
esac

# --- Done ---
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Your assistant is running! Send a message in WhatsApp to test."
echo ""
echo "Useful commands:"
echo "  npm run dev      - Run in development mode (with hot reload)"
echo "  npm run auth     - Re-authenticate WhatsApp"
echo ""

case "$OS" in
  Darwin)
    echo "Service management (macOS):"
    echo "  launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist  # Stop"
    echo "  launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist    # Start"
    ;;
  Linux)
    echo "Service management (Linux):"
    echo "  sudo systemctl status groupguard   # Check status"
    echo "  sudo systemctl restart groupguard   # Restart"
    echo "  sudo systemctl stop groupguard      # Stop"
    echo "  journalctl -u groupguard -f         # View logs"
    ;;
esac
