# GroupGuard

WhatsApp group moderation powered by Claude.

## Quick Start

```bash
git clone git@github.com:TomGranot/groupguard.git
cd groupguard
./setup.sh
```

**Requirements:** Node.js 20+, macOS 26+ (Apple Containers) or Docker, [Claude Code](https://claude.ai/download)

## What It Does

GroupGuard sits in your WhatsApp groups and enforces rules automatically. Messages that violate rules get deleted instantly, and the sender gets a private explanation. Admins control everything through natural language.

```
@GroupGuard enable no-spam and no-links for this group
@GroupGuard set observation mode (log violations but don't delete)
@GroupGuard show moderation stats for the last week
@GroupGuard add a keyword filter blocking "crypto" and "forex"
```

Beyond moderation, it's a full Claude assistant — it can answer questions, search the web, schedule tasks, and manage files. The moderation runs silently in the background.

## Guards

14 built-in rules organized into four categories:

**Content Type** — what format is allowed
| Guard | What it does |
|-------|-------------|
| `text-only` | Only allow text messages |
| `video-only` | Only allow video messages |
| `voice-only` | Only allow voice notes |
| `media-only` | Only allow media, block text |
| `no-stickers` | Block stickers |
| `no-images` | Block images |

**Content Property** — message characteristics
| Guard | What it does | Config |
|-------|-------------|--------|
| `no-links` | Block URLs | — |
| `no-forwarded` | Block forwarded messages | — |
| `max-text-length` | Block long messages | `maxLength` (default: 2000) |
| `keyword-filter` | Block keywords or regex patterns | `keywords`, `patterns` |

**Behavioral** — rate limiting and access control
| Guard | What it does | Config |
|-------|-------------|--------|
| `no-spam` | Block rapid-fire messages | `maxMessages` (5), `windowSeconds` (10) |
| `slow-mode` | One message per N minutes | `intervalMinutes` (5) |
| `quiet-hours` | Block during certain hours | `startHour` (22), `endHour` (7) |
| `approved-senders` | Whitelist-only mode | `allowedJids` |

Guards run on the host process, not inside the container — enforcement is instant.

## How Moderation Works

```
Message arrives
    |
    v
Is sender a group admin?  -->  Yes: skip guards (if adminExempt=true)
    |
    No
    v
Run all enabled guards for this group
    |
    v
Any guard blocks?  -->  No: store message, process normally
    |
    Yes
    v
Observation mode?  -->  Yes: log violation, store message anyway
    |
    No
    v
Delete message + DM sender with reason + log violation
```

Each group has independent guard configurations:

```json
{
  "guards": [
    { "guardId": "no-spam", "enabled": true, "params": { "maxMessages": 5 } },
    { "guardId": "no-links", "enabled": true }
  ],
  "moderationConfig": {
    "observationMode": false,
    "adminExempt": true,
    "dmCooldownSeconds": 60
  }
}
```

- **Observation mode**: Log violations without deleting — useful for testing rules
- **Admin exempt**: Group admins bypass all guards
- **DM cooldown**: One notification per user per 60s to prevent spam

All violations are logged to SQLite with timestamp, sender, guard ID, action, and reason.

## Usage

Talk to your bot with the trigger word (default: `@GroupGuard`):

```
@GroupGuard enable no-spam for this group
@GroupGuard show me the last 10 moderation violations
@GroupGuard schedule a daily summary at 9am
@GroupGuard what's the weather in Tel Aviv?
```

From the main channel, you have admin control over all groups:
```
@GroupGuard list all groups and their guard configs
@GroupGuard enable observation mode for Work Team
@GroupGuard register the "Family Chat" group
```

## Deploying to a Server

GroupGuard needs a container runtime (Docker or Apple Containers) to spawn agent containers.

### Local macOS (free)

Just run `./setup.sh`. It auto-detects Apple Containers (macOS 26+) or Docker Desktop and installs a launchd service that starts on boot.

### Hetzner VPS ($4/mo, always-on)

Best value for an always-on server.

1. Create a [Hetzner Cloud](https://www.hetzner.com/cloud/) server: **CX22** (2 vCPU, 4 GB RAM), Docker CE app image, Ubuntu 24.04
2. SSH in and run:

```bash
# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 22

# Clone and setup
git clone git@github.com:TomGranot/groupguard.git /opt/groupguard
cd /opt/groupguard
echo 'ANTHROPIC_API_KEY=your-key-here' > .env
./setup.sh

# Authenticate WhatsApp (scan QR code)
npm run auth
sudo systemctl start groupguard
```

### Other VPS Options

| Provider | Cost | Notes |
|----------|------|-------|
| **DigitalOcean** | $6-12/mo | Docker 1-Click image |
| **Vultr** | $6-10/mo | Startup scripts |
| **Linode/Akamai** | $5/mo+ | StackScripts |
| **Oracle Cloud** | Free | ARM A1 (hard to provision) |

### Updating

```bash
cd /opt/groupguard
git pull
npm install
npm run build
./container/build.sh
sudo systemctl restart groupguard  # or launchctl on macOS
```

## Architecture

```
WhatsApp (baileys) --> Guard filter --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response
```

Single Node.js process. Moderation runs on the host for instant enforcement. Agent responses run in isolated containers with mounted directories. Per-group message queues. IPC via filesystem.

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: WhatsApp connection, message routing, IPC |
| `src/moderator.ts` | Guard evaluation, DM enforcement, admin caching |
| `src/guards/` | Guard implementations (content, property, behavioral, keyword) |
| `src/container-runner.ts` | Spawns containers with runtime detection (Docker/Apple) |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations (messages, moderation logs, tasks) |
| `groups/*/CLAUDE.md` | Per-group memory (isolated) |

## Customizing

The codebase is small enough to modify safely. Tell Claude Code what you want:

- "Add a new guard that blocks messages with more than 3 emojis"
- "Change the DM message format when a message is blocked"
- "Add a daily moderation report sent to the admin group"

Or run `/customize` for guided changes.

## Troubleshooting

- **Container runtime not running** — macOS: start Docker Desktop or ensure Apple Containers is available. Linux: `sudo systemctl start docker`
- **WhatsApp auth expired** — Run `npm run auth` to re-authenticate, then restart
- **Service not starting** — Check `logs/nanoclaw.log` and `logs/nanoclaw.error.log`
- **No response to messages** — Check the trigger pattern, verify the group is registered
- **Guards not working** — Check logs: `sqlite3 store/messages.db "SELECT * FROM moderation_log ORDER BY timestamp DESC LIMIT 10"`
- **Container networking on macOS** — Docker Desktop handles this automatically. For Apple Containers or colima/lima, run `sudo ./scripts/macos-networking.sh`

Run `/debug` in Claude Code for guided troubleshooting.

## License

MIT

---

Built on [NanoClaw](https://github.com/gavrielc/nanoclaw).
