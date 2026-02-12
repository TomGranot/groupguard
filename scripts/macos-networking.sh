#!/bin/bash
# macOS networking setup for Apple Containers and non-Desktop Docker
#
# Apple Containers use vmnet bridge (192.168.64.0/24) which needs:
# - IP forwarding enabled
# - NAT rules for outbound traffic
#
# Docker Desktop handles this automatically — this script is only needed for
# Apple Containers or alternative Docker installations (colima, lima, etc.).
#
# Usage: sudo ./scripts/macos-networking.sh
#        sudo ./scripts/macos-networking.sh --non-interactive

set -e

NON_INTERACTIVE=false
if [[ "$1" == "--non-interactive" ]]; then
  NON_INTERACTIVE=true
fi

# Check if running as root
if [[ $EUID -ne 0 ]]; then
  echo "This script must be run with sudo:"
  echo "  sudo $0"
  exit 1
fi

# Check if Docker Desktop is handling networking
if command -v docker &>/dev/null && docker info 2>/dev/null | grep -q "Desktop"; then
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

# Step 1: Enable IP forwarding (idempotent)
CURRENT_FWD=$(sysctl -n net.inet.ip.forwarding 2>/dev/null || echo "0")
if [[ "$CURRENT_FWD" != "1" ]]; then
  echo "Enabling IP forwarding..."
  sysctl -w net.inet.ip.forwarding=1
else
  echo "IP forwarding already enabled."
fi

# Step 2: Add NAT rule (idempotent — check if rule already active)
if pfctl -s nat 2>/dev/null | grep -q "192.168.64.0/24"; then
  echo "NAT rule already active."
else
  echo "Adding NAT rule for container bridge network..."
  echo "nat on $INTERFACE from 192.168.64.0/24 to any -> ($INTERFACE)" | pfctl -ef - 2>/dev/null
fi

echo ""
echo "Networking configured. These settings will reset on reboot."
echo ""

# Step 3: Create launchd daemon for persistence
PLIST="/Library/LaunchDaemons/com.groupguard.networking.plist"

if [[ -f "$PLIST" ]]; then
  echo "Persistence already configured ($PLIST exists)."
elif [[ "$NON_INTERACTIVE" == true ]]; then
  # Non-interactive mode: always install persistence
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
else
  read -p "Make persistent across reboots? (y/N) " -n 1 -r
  echo ""

  if [[ $REPLY =~ ^[Yy]$ ]]; then
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
fi

echo "Done."
