# Deploying GroupGuard

Use a local foreground process for setup and observation. Use a dedicated VM for 24/7 moderation.

The moderation-only profile needs Node.js 20 or newer. It does not need Docker, an AI provider, a public port, or a reverse proxy.

## Recommended production layout

- A separate WhatsApp number
- One small Linux VM
- One low-privilege OS user
- Encrypted disk where the provider supports it
- One GroupGuard process and one private state directory
- systemd supervision
- SSH or Tailscale for administration

Do not expose GroupGuard to the public internet. It has no web control plane.

## Linux VM

Ubuntu 24.04 with 1 shared vCPU, 1 GB RAM, and 10 GB disk is enough for moderation-only use. The optional Claude agent needs Docker and more memory.

Install Node.js using your preferred version manager, then run:

```bash
git clone https://github.com/TomGranot/groupguard.git
cd groupguard
./setup.sh
```

Link WhatsApp and choose groups from the interactive setup. Keep enforcement off during the observation period.

Install a per-user systemd service:

```bash
./scripts/install-service.sh
systemctl --user status groupguard
```

Ask the host administrator to enable user lingering if the service must start before you log in:

```bash
sudo loginctl enable-linger "$USER"
```

The service reads `.env`, writes logs under `logs/`, and restarts after process failures. GroupGuard limits its own WhatsApp reconnect attempts and exits when that budget runs out.

## Local macOS

Run setup and observe in the foreground first:

```bash
./setup.sh
npm start
```

Install a per-user launchd service only if the Mac stays awake and connected:

```bash
./scripts/install-service.sh
launchctl print "gui/$UID/com.groupguard"
```

A laptop is useful for testing but unreliable for continuous moderation because sleep and network changes interrupt the linked-device session.

## Optional agent profile

Install Docker only when you need the Claude agent. Then:

1. Add `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` to `.env`.
2. Set `GROUPGUARD_AGENT_ENABLED=true`.
3. Keep `GROUPGUARD_AGENT_PROJECT_WRITE_ENABLED=false`.
4. Run `./container/build.sh`.
5. Run `npm run doctor`.
6. Restart the service.

Plan for at least 2 vCPU and 4 GB RAM when agent containers run.

## Updating

Stop the service before changing dependencies or database code:

```bash
systemctl --user stop groupguard
cp -a data "data.backup.$(date +%Y%m%d)"
cp -a store "store.backup.$(date +%Y%m%d)"
git pull --ff-only
npm ci
npm test
npm run build
npm run doctor
systemctl --user start groupguard
```

Return all groups to observation mode before a transport or schema upgrade.

## Health and logs

```bash
npm run doctor
systemctl --user status groupguard
journalctl --user -u groupguard -n 200 --no-pager
sqlite3 store/messages.db \
  "SELECT timestamp, guard_id, action, reason FROM moderation_log ORDER BY timestamp DESC LIMIT 50"
```

The older `scripts/health-check.sh` targets a system-wide Linux service. Prefer `npm run doctor` for configuration checks and your service supervisor for liveness.

## State and backups

Protect these paths:

| Path | Contents | Sensitivity |
|---|---|---|
| `.env` | Runtime settings and optional AI credentials | Secret |
| `store/auth` | Linked WhatsApp session | Critical credential |
| `store/messages.db` | Messages, tasks, moderation audit | Private data |
| `data` | Group and session state | Private data |
| `groups` | Per-group memory and files | Private data |

Use one writable copy of `store/auth` per number. Never mount it into an agent container or share it between production and development.
