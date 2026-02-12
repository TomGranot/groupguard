# GroupGuard

WhatsApp group moderation powered by Claude. Automated content filtering, spam prevention, and natural-language admin controls — all running in isolated containers.

Built on [NanoClaw](https://github.com/gavrielc/nanoclaw).

## What It Does

GroupGuard sits in your WhatsApp groups and enforces rules automatically. Messages that violate rules get deleted instantly, and the sender gets a private explanation. Admins control everything through natural language — just tell the bot what you want.

```
@GroupGuard enable no-spam and no-links for Family Chat
@GroupGuard set observation mode for Work Team (log violations but don't delete)
@GroupGuard show moderation stats for the last week
@GroupGuard disable quiet-hours for the Main group
```

Beyond moderation, it's a full Claude assistant — it can answer questions, search the web, schedule tasks, and manage files. The moderation just runs silently in the background.

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

Guards run on the host process, not inside the container — enforcement is instant. Messages blocked by guards never reach the database.

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

Each group has independent guard configurations and a moderation config:

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

- **Observation mode**: Log violations without deleting — useful for testing rules before enforcing
- **Admin exempt**: Group admins bypass all guards
- **DM cooldown**: Prevent notification spam (one DM per user per 60s)

All violations are logged to SQLite with timestamp, sender, guard ID, action, and reason.

## Quick Start

```bash
git clone git@github.com:TomGranot/groupguard.git
cd groupguard
./setup.sh
```

Or use Claude Code for guided setup: run `claude` then `/setup`.

**Requirements:** Node.js 20+, Docker, [Claude Code](https://claude.ai/download) (for API key)

## Architecture

```
WhatsApp (baileys) --> Guard filter --> SQLite --> Polling loop --> Docker (Claude Agent SDK) --> Response
```

Single Node.js process. Moderation runs on the host for instant enforcement. Agent responses run in isolated Docker containers with mounted directories. Per-group message queues. IPC via filesystem.

Key files:
- `src/index.ts` — Main app: WhatsApp connection, message routing, IPC
- `src/moderator.ts` — Guard evaluation, DM enforcement, admin caching
- `src/guards/` — Guard implementations (content, property, behavioral, keyword)
- `src/container-runner.ts` — Spawns streaming agent containers
- `src/task-scheduler.ts` — Runs scheduled tasks
- `src/db.ts` — SQLite operations (messages, moderation logs, groups, sessions)
- `groups/*/CLAUDE.md` — Per-group memory

## Features

- **14 moderation guards** — Content filtering, spam prevention, rate limiting, keyword blocking
- **Observation mode** — Test rules without enforcing them
- **WhatsApp I/O** — Message Claude from your phone, manage groups naturally
- **Isolated group context** — Each group has its own memory, filesystem, and container sandbox
- **Main channel** — Your private admin control channel with elevated privileges
- **Scheduled tasks** — Recurring jobs that run Claude and can message you back
- **Web access** — Search and fetch content
- **Container isolation** — Agents sandboxed in Docker containers (macOS/Linux)
- **Moderation logging** — Full audit trail in SQLite

## Usage

Talk to your bot with the trigger word (default: `@GroupGuard`):

```
@GroupGuard enable no-spam for this group
@GroupGuard show me the last 10 moderation violations
@GroupGuard add a keyword filter blocking "crypto" and "forex"
@GroupGuard schedule a daily summary of moderation activity at 9am
```

From the main channel, you have admin control over all groups:
```
@GroupGuard list all groups and their guard configs
@GroupGuard enable observation mode for Work Team
@GroupGuard show moderation stats across all groups
```

## Deploying to a Server

GroupGuard needs Docker to spawn agent containers, which rules out most managed platforms — you need a real VM.

### Option 1: One-Click Deploy (exe.dev) — $20/month

The fastest path. [exe.dev](https://exe.dev) gives you a VM with Docker pre-installed and an AI agent that sets everything up.

After the VM is provisioned (~5 min), authenticate WhatsApp:

```bash
ssh <vm-name>.exe.xyz
cd /opt/groupguard && npm run auth   # scan QR code with your phone
sudo systemctl start groupguard      # start the service
```

### Option 2: Budget VPS (Hetzner) — ~$4/month

Best value. [Hetzner Cloud](https://www.hetzner.com/cloud/) with dedicated resources.

1. Create a server: **CX22** (2 vCPU, 4 GB RAM, 40 GB disk), Docker CE app image, Ubuntu 24.04
2. SSH in and run:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 22

git clone git@github.com:TomGranot/groupguard.git /opt/groupguard
cd /opt/groupguard
echo 'ANTHROPIC_API_KEY=your-key-here' > .env
./setup.sh

npm run auth                          # scan QR code
sudo systemctl start groupguard       # start the service
```

### Other Options

| Provider | Cost | Notes |
|----------|------|-------|
| **DigitalOcean** | $6-12/mo | Docker 1-Click image |
| **Vultr** | $6-10/mo | Startup scripts |
| **Linode/Akamai** | $5/mo+ | StackScripts |
| **Oracle Cloud** | Free | ARM A1 (hard to provision) |
| **Local macOS** | Free | Docker Desktop + launchd via `./setup.sh` |

## Troubleshooting

- **Docker not running** — macOS: start Docker Desktop. Linux: `sudo systemctl start docker`
- **WhatsApp auth expired** — Run `npm run auth` to re-authenticate, then restart
- **Service not starting** — Check `logs/nanoclaw.log` and `logs/nanoclaw.error.log`
- **No response to messages** — Check the trigger pattern, verify the group is registered
- **Guards not working** — Check moderation logs: `sqlite3 store/messages.db "SELECT * FROM moderation_log ORDER BY timestamp DESC LIMIT 10"`
- **Container networking on macOS** — Docker Desktop handles this automatically. If using colima/lima, run `sudo ./scripts/macos-networking.sh`

Run `/debug` in Claude Code for guided troubleshooting.

## Customizing

The codebase is small enough to modify safely. Tell Claude Code what you want:

- "Add a new guard that blocks messages with more than 3 emojis"
- "Change the DM message format when a message is blocked"
- "Add a daily moderation report that gets sent to the admin group"

Or run `/customize` for guided changes.

## Based On

GroupGuard is built on [NanoClaw](https://github.com/gavrielc/nanoclaw), a lightweight personal Claude assistant. NanoClaw provides the core architecture (WhatsApp connection, container isolation, scheduling, IPC) and GroupGuard adds the moderation layer on top.

## License

MIT
