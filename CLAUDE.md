# GroupGuard

WhatsApp group moderation powered by Claude. See [README.md](README.md) for features and setup.

## Quick Context

Single Node.js process that connects to WhatsApp, runs moderation guards on the host, and routes messages to Claude Agent SDK running in Docker containers. Each group has isolated filesystem, memory, and guard configuration.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: WhatsApp connection, message routing, IPC |
| `src/moderator.ts` | Guard evaluation, DM enforcement, admin caching |
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
./container/build.sh # Rebuild agent container
```

## Container Build Cache

To force a clean rebuild:

```bash
docker builder prune -af
./container/build.sh
```

Verify after rebuild: `docker run --rm --entrypoint wc groupguard-agent:latest -l /app/src/index.ts`
