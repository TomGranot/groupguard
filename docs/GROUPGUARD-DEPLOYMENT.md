# GroupGuard deployment runbook

## Reference host

The reference setup uses one persistent exe.dev VM with 4 vCPU, 8 GB RAM, and 25 GB disk. exe.dev exposes ordinary Linux VMs over SSH and keeps their disks across restarts. GroupGuard does not need a public HTTP port.

Use `qwen3:4b` for the category classifier. Its common Q4 package occupies about 2.5 GB before runtime overhead. An 8 GB VM leaves room for Ollama, Node.js, SQLite, and the WhatsApp session. Use `qwen3:8b` only after raising memory to at least 12 GB and testing latency with your taxonomy.

## Persistent paths

Back up these paths with encryption:

| Path | Purpose |
| --- | --- |
| `.env` | Host locks and WhatsApp pairing input |
| `store/auth/` | WhatsApp linked-device credentials |
| `config/groupguard.json` | Allowlisted groups and policies |
| `config/taxonomy.json` | Closed category taxonomy |
| `config/directory.json` | Local directory source, if used |
| `data/groupguard/` | Directory cache and effect ledger |

The repository ignores each path. Check file modes after restoring a backup:

```bash
chmod 600 .env config/*.json
chmod -R go-rwx store/auth data/groupguard
```

## Boot sequence

GroupGuard performs these steps before it accepts a message:

1. Parse the group policy and create an immutable allowlist.
2. Open the SQLite effect ledger.
3. Validate the taxonomy and load the last directory cache.
4. Refresh the directory from the configured source.
5. Prewarm Qwen through Ollama and schedule the next refresh.
6. Connect the WhatsApp linked device.

A policy error leaves the WhatsApp connection available for pairing and metadata discovery, but closes message ingress.

## Health check

```bash
pnpm groupguard:doctor
```

The doctor prints counts and component status. It does not print group IDs, sender IDs, phone numbers, provider contacts, or message content.

Check the local model:

```bash
ollama list
curl --fail --silent http://127.0.0.1:11434/api/tags >/dev/null
```

GroupGuard calls the model with `keep_alive: 25h`. It also prewarms after boot and each successful daily directory refresh.

## Service operations

Run the NanoClaw setup flow once to install its per-user systemd unit:

```bash
pnpm setup
```

The setup output prints the unit name for your checkout. Use that exact name with `systemctl --user status`, `restart`, and `journalctl --user-unit`.

After a deploy:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm groupguard:doctor
systemctl --user restart <unit-name>
```

Keep the old process running until tests and the doctor pass.

## Directory refresh

GroupGuard refreshes every 24 hours by default. It downloads an HTTPS source with a timeout, validates all categories, provider IDs, contacts, and recommendation evidence, then swaps the cache with an atomic rename. It keeps the last valid snapshot when the source fails or returns bad data.

Use a versioned endpoint or file. Publish a complete snapshot rather than incremental changes.

## WhatsApp session maintenance

The remote linked device does not need the phone online during normal operation. WhatsApp disconnects linked devices when the primary app remains unused for more than 14 days. Open the primary app within that period and keep the number active.

GroupGuard caps reconnect attempts and adds exponential backoff with jitter. It resets the reconnect budget after a stable connection. A logged-out session requires a new pairing.

## Recovery

For a broken directory source:

1. Leave the process running if the cached snapshot still validates.
2. Repair the source.
3. Restart GroupGuard to trigger a refresh and prewarm.
4. Run the doctor.

For a lost WhatsApp session:

1. Stop the service.
2. Back up the current `store/auth/` for investigation.
3. Remove only that auth directory.
4. Start GroupGuard and pair the account again.

For unexpected moderation behavior, switch the affected group back to observation mode before investigating:

```bash
pnpm groupguard:enforcement -- --group '<group-id>@g.us' --observe
```
