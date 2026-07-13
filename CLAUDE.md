# GroupGuard

Safety-first WhatsApp group moderation with an optional Claude agent. See [README.md](README.md) for setup and [docs/SAFE-OPERATIONS.md](docs/SAFE-OPERATIONS.md) for enforcement rules.

## Quick Context

Single Node.js process that connects to WhatsApp and runs moderation guards on the host. Docker and the Claude Agent SDK remain disabled unless the operator enables agent mode. Each group has isolated configuration and optional agent memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: WhatsApp connection, message routing, IPC |
| `src/moderator.ts` | Guard evaluation, DM enforcement, admin caching |
| `src/account-safety.ts` | Account budgets and failure circuit |
| `src/group-config.ts` | Strict config validation and safe defaults |
| `src/playground.ts` | Fixed-command public demo and local rate limits |
| `src/playground-cli.ts` | Sealed playground profile and audit key setup |
| `src/guards/` | Guard implementations (content, property, behavioral, keyword) |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns Docker containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations (messages, moderation logs) |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/groupguard-setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |

## Development

Run commands directly — don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
npm run doctor       # Validate auth, config, and runtime
npm test             # Run safety tests
./container/build.sh # Rebuild agent container
```

## Container Build Cache

To force a clean rebuild:

```bash
docker builder prune -af
./container/build.sh
```

Verify after rebuild: `docker run --rm --entrypoint wc groupguard-agent:latest -l /app/src/index.ts`
