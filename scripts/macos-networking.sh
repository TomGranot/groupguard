#!/bin/bash
# macOS networking setup for non-Desktop Docker (colima, lima, etc.)
# Docker Desktop handles networking automatically — this script is only needed
# for alternative Docker installations on macOS.
#
# Usage: sudo ./scripts/macos-networking.sh

set -e

# Check if running as root
if [[ $EUID -ne 0 ]]; then
  echo "This script must be run with sudo:"
  echo "  sudo $0"
  exit 1
fi

# Check if Docker Desktop is handling networking
if docker info 2>/dev/null | grep -q "Desktop"; then
  echo "Docker Desktop detected — networking is handled automatically."
  echo "You don't need this script."
  exit 0
fi

# Detect the active internet interface
INTERFACE=$(route get 8.8.8.8 2>/dev/null | grep interface | awk '{print $2}')
if [[ -z "$INTERFACE" ]]; then
  echo "Could not detect active network interface. Defaulting to en0."
  INTERFACE="en0"
fi

echo "Active interface: $INTERFACE"

# Step 1: Enable IP forwarding
echo "Enabling IP forwarding..."
sysctl -w net.inet.ip.forwarding=1

# Step 2: Add NAT rule
echo "Adding NAT rule for Docker bridge network..."
echo "nat on $INTERFACE from 192.168.64.0/24 to any -> ($INTERFACE)" | pfctl -ef - 2>/dev/null

echo ""
echo "Networking configured. These settings will reset on reboot."
echo ""

# Step 3: Create launchd daemon for persistence
read -p "Make persistent across reboots? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  PLIST="/Library/LaunchDaemons/com.groupguard.networking.plist"

  cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.groupguard.networking</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>sysctl -w net.inet.ip.forwarding=1 &amp;&amp; echo "nat on $INTERFACE from 192.168.64.0/24 to any -> ($INTERFACE)" | pfctl -ef -</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF

  launchctl load "$PLIST" 2>/dev/null || true
  echo "Persistence configured via $PLIST"
fi

echo "Done."
