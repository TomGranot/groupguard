#!/usr/bin/env bash
#
# GroupGuard Health Check
#
# Checks process status, WhatsApp connection, and recent activity.
# Designed to run from cron or a monitoring system.
#
# Exit codes:
#   0 = healthy
#   1 = unhealthy
#
# Usage:
#   ./scripts/health-check.sh              # Print status
#   ./scripts/health-check.sh --webhook URL # POST to webhook on failure
#
set -euo pipefail

WEBHOOK_URL="${2:-}"
SERVICE_NAME="groupguard"
LOG_FILE="/tmp/groupguard-health.log"
MAX_IDLE_SECONDS="${MAX_IDLE_SECONDS:-3600}"  # Alert if no activity for 1 hour

healthy=true
issues=()

check_process() {
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo "[OK] Service is running"
  else
    echo "[FAIL] Service is not running"
    issues+=("Service not running")
    healthy=false
  fi
}

check_docker() {
  if docker info &>/dev/null; then
    echo "[OK] Docker is running"
  else
    echo "[FAIL] Docker is not running"
    issues+=("Docker not running")
    healthy=false
  fi
}

check_disk() {
  local usage
  usage=$(df / --output=pcent | tail -1 | tr -d ' %')
  if [ "$usage" -lt 90 ]; then
    echo "[OK] Disk usage: ${usage}%"
  else
    echo "[WARN] Disk usage high: ${usage}%"
    issues+=("Disk usage ${usage}%")
    if [ "$usage" -ge 95 ]; then
      healthy=false
    fi
  fi
}

check_memory() {
  local mem_pct
  mem_pct=$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')
  if [ "$mem_pct" -lt 90 ]; then
    echo "[OK] Memory usage: ${mem_pct}%"
  else
    echo "[WARN] Memory usage high: ${mem_pct}%"
    issues+=("Memory usage ${mem_pct}%")
  fi
}

check_recent_logs() {
  # Check if there are recent logs (service is actually doing something)
  if journalctl -u "$SERVICE_NAME" --since "5 min ago" --no-pager -q 2>/dev/null | grep -q .; then
    echo "[OK] Recent log activity found"
  else
    echo "[WARN] No log activity in last 5 minutes"
    issues+=("No recent log activity")
  fi
}

check_whatsapp_connection() {
  # Look for WhatsApp connection status in recent logs
  local last_connected
  last_connected=$(journalctl -u "$SERVICE_NAME" --no-pager -q 2>/dev/null | \
    grep -o "Connected to WhatsApp" | tail -1 || true)

  if [ -n "$last_connected" ]; then
    echo "[OK] WhatsApp connection established"
  else
    echo "[INFO] No WhatsApp connection log found (may be normal on first run)"
  fi

  # Check for disconnect errors
  local recent_errors
  recent_errors=$(journalctl -u "$SERVICE_NAME" --since "10 min ago" --no-pager -q 2>/dev/null | \
    grep -c "Connection closed\|loggedOut\|authentication required" || true)

  if [ "$recent_errors" -gt 0 ]; then
    echo "[WARN] Found $recent_errors connection issues in last 10 minutes"
    issues+=("$recent_errors connection issues in last 10 min")
  fi
}

check_containers() {
  # Check for stuck/orphaned containers
  local running
  running=$(docker ps --filter "name=groupguard-" --format "{{.Names}} ({{.Status}})" 2>/dev/null || true)

  if [ -n "$running" ]; then
    echo "[INFO] Running containers:"
    echo "$running" | while read -r line; do echo "  $line"; done
  else
    echo "[OK] No running agent containers"
  fi
}

send_webhook() {
  if [ -z "$WEBHOOK_URL" ]; then return; fi

  local status="unhealthy"
  local message
  message=$(printf '%s\n' "${issues[@]}" | head -5)

  curl -s -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{
      \"status\": \"$status\",
      \"service\": \"$SERVICE_NAME\",
      \"issues\": \"$message\",
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
      \"hostname\": \"$(hostname)\"
    }" > /dev/null 2>&1 || echo "[WARN] Failed to send webhook"
}

# Run all checks
echo "=== GroupGuard Health Check ==="
echo "Time: $(date)"
echo ""

check_process
check_docker
check_disk
check_memory
check_recent_logs
check_whatsapp_connection
check_containers

echo ""
if $healthy; then
  echo "Status: HEALTHY"
  exit 0
else
  echo "Status: UNHEALTHY"
  echo "Issues: ${issues[*]}"
  send_webhook
  exit 1
fi
