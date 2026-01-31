# Deploying GroupGuard

GroupGuard works great locally, but for 24/7 availability you'll want it on a server. It needs Docker to spawn agent containers, which rules out most managed platforms (Railway, Render, Fly.io) — you need a real VM.

## Local macOS (free)

Install [Docker Desktop](https://docker.com/products/docker-desktop), then:

```bash
git clone git@github.com:TomGranot/groupguard.git
cd groupguard
./setup.sh
```

## Hetzner VPS (~$4/month, always-on)

Best value for an always-on server.

1. Create a [Hetzner Cloud](https://www.hetzner.com/cloud/) server: **CX22** (2 vCPU, 4 GB RAM, 40 GB disk), **Docker CE** app image, Ubuntu 24.04
2. SSH in and run:

```bash
# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 22

# Clone and set up
git clone git@github.com:TomGranot/groupguard.git /opt/groupguard
cd /opt/groupguard
echo 'ANTHROPIC_API_KEY=your-key-here' > .env
./setup.sh

# Authenticate WhatsApp (scan QR with your phone)
npm run auth

# Start the service
sudo systemctl start groupguard
```

**Specs:** 2 vCPU, 4 GB RAM (dedicated), 40 GB NVMe, 20 TB traffic. ~EUR 3.49/month.

## Other VPS Options

| Provider | Cost | Notes |
|----------|------|-------|
| **DigitalOcean** | $6-12/mo | Docker 1-Click Marketplace image. [digitalocean.com](https://www.digitalocean.com) |
| **Vultr** | $6-10/mo | Startup scripts for automated setup. [vultr.com](https://www.vultr.com) |
| **Linode/Akamai** | $5/mo+ | StackScripts for parameterized deployment. [linode.com](https://www.linode.com) |
| **Oracle Cloud** | Free | ARM A1 instance. Generous but hard to provision — expect "out of capacity" errors. [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) |

All options need Docker installed. The setup is the same everywhere: clone, `./setup.sh`, `npm run auth`, start the service.

## Running as a Service

### Linux (systemd)

The setup script installs a systemd service automatically. Manual control:

```bash
sudo systemctl start groupguard
sudo systemctl stop groupguard
sudo systemctl restart groupguard
sudo systemctl status groupguard
```

### macOS (launchd)

```bash
# Install
cp launchd/com.groupguard.plist ~/Library/LaunchAgents/

# Start/stop
launchctl load ~/Library/LaunchAgents/com.groupguard.plist
launchctl unload ~/Library/LaunchAgents/com.groupguard.plist

# Check status
launchctl list | grep groupguard
```

## Updating

```bash
cd /opt/groupguard
git pull
npm install
npm run build
./container/build.sh
sudo systemctl restart groupguard  # or launchctl on macOS
```

## Troubleshooting

- **Docker not running** — macOS: start Docker Desktop. Linux: `sudo systemctl start docker`
- **WhatsApp auth expired** — Run `npm run auth` to re-authenticate, then restart
- **Service not starting** — Check `logs/groupguard.log` and `logs/groupguard.error.log`
- **No response to messages** — Verify the group is registered and the trigger pattern matches
- **Guards not working** — Check the moderation log: `sqlite3 store/messages.db "SELECT * FROM moderation_log ORDER BY timestamp DESC LIMIT 10"`

Run `/debug` in Claude Code for guided troubleshooting.
