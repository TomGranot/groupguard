# Safe Operations

GroupGuard cannot remove the account risk created by an unofficial WhatsApp client. It can reduce avoidable risk by limiting actions, refusing uncertain work, and making enforcement a local operator decision.

## Recommended starting point

Use all four controls together:

1. Link a separate WhatsApp number that you can afford to lose.
2. Run GroupGuard on your computer in the foreground for the first observation day.
3. Keep the AI agent disabled.
4. Move the same installation to a dedicated low-privilege VM only after the logs look correct.

Do not test with your main personal or business number. Do not connect two GroupGuard instances to the same `store/auth` directory or number.

## Public playground

A public trial group needs a separate risk boundary. Use a dedicated number, VM, installation, and state directory. Register only the playground group, then enable its sealed profile:

```bash
npm run playground -- enable playground --dedicated-account
npm run doctor
```

Playground mode demonstrates rule decisions through fixed commands. It keeps AI, enforcement, DMs, and typing indicators off, and it does not automate membership. Read [GroupGuard Playground](PLAYGROUND.md) before sharing an invite link.

## Trust ladder

### Stage 1: Observe

Setup places every group here. GroupGuard evaluates enabled guards and writes violations to SQLite. It does not delete or DM.

Stay in this stage for at least 24 hours. Check false positives, admin recognition, reconnect stability, and the expected message volume.

```bash
npm run enforcement -- status
sqlite3 store/messages.db \
  "SELECT timestamp, chat_jid, guard_id, action, reason FROM moderation_log ORDER BY timestamp DESC LIMIT 100"
```

### Stage 2: Enforce one narrow rule

Start with one group and one deterministic guard. `no-spam` with its default threshold is the starter profile. Keep admin exemption on and moderation DMs off.

```bash
npm run enforcement -- enable <group-folder>
```

The command checks the observation period, sets the group's mode, and opens the operator lock in `.env`. Restart the process, run `npm run doctor`, and watch the log.

### Stage 3: Add rules one at a time

Observe each new rule before it can delete messages. Content rules can generate false positives. Regular-expression rules need extra care because a broad expression can match every message.

Raw regular expressions also risk excessive CPU use on crafted input. GroupGuard rejects them unless the operator sets `GROUPGUARD_ALLOW_REGEX_FILTERS=true` outside WhatsApp. Prefer plain keywords.

Keep participant removal, bulk messaging, and automatic promotion or demotion outside the default feature set. Those actions carry more account and community risk than message deletion.

## Safety mechanisms

GroupGuard applies these controls before a WhatsApp mutation:

- A message ID must exist.
- A durable SQLite claim must succeed. Replayed events cannot run twice.
- The group must leave observation mode.
- The local operator lock must be open.
- The admin list must be verified when admin exemption is on.
- The relevant account budget must have capacity.
- The shared failure circuit must remain closed.
- Typing-presence updates remain disabled unless the operator opts in.

A timeout produces an `unknown` result. GroupGuard does not repeat that action because WhatsApp may have completed it before the response disappeared.

Default budgets:

| Action | Default budget |
|---|---:|
| Agent or scheduled messages | 8 per minute |
| Message deletions | 12 per minute |
| Moderation DMs | 6 per hour |
| Consecutive failures before pause | 3 |
| Failure pause | 15 minutes |

These numbers are conservative product defaults, not published WhatsApp limits. Lower them for sensitive accounts. Raise them only after stable operation and deliberate review.

After repeated reconnect failures, GroupGuard exits cleanly. The supplied service definitions do not restart a clean safety exit. Diagnose the connection and restart the service yourself.

## Runtime choice

### Your computer

Use it for setup, linking, and the first observation test. Keep the process in the foreground so you see disconnects and config errors. Laptop sleep and network changes make it a poor 24/7 runtime.

### Dedicated VM

Use a small VM for continuous operation. Create a dedicated OS user, restrict `.env` and `store/auth` to that user, enable disk encryption where available, and supervise the process with systemd.

The moderation-only profile does not need Docker. Install Docker only when you enable the optional agent.

### Containers

Do not bake `.env`, `store/auth`, or `data` into an image. Mount one private state directory into one instance. Never share writable auth state between replicas.

## Optional agent

Messages can contain prompt injection. Treat every group message as untrusted input.

- Keep `GROUPGUARD_AGENT_ENABLED=false` unless you need agent features.
- Keep `GROUPGUARD_AGENT_PROJECT_WRITE_ENABLED=false` during normal operation.
- Give non-admin groups no additional host mounts.
- Keep mount roots narrow and read-only.
- Use a solo admin group for agent control.
- Review scheduled tasks because they can create outbound messages without a new inbound message.

The container reduces host filesystem risk. It does not make arbitrary network access or unattended external actions harmless.

## Incident response

If WhatsApp shows a warning, logs repeated failures, or sends unexpected messages:

1. Stop GroupGuard.
2. Set `GROUPGUARD_ENFORCEMENT_ENABLED=false` and `GROUPGUARD_AGENT_ENABLED=false` in `.env`.
3. Run `npm run doctor`.
4. Inspect `moderation_log` and `moderation_actions` in `store/messages.db`.
   For a public playground, also inspect `playground_events` and revoke the group invite link.
5. Check WhatsApp's Linked Devices screen and remove unknown sessions.
6. Resume in observation mode only after you identify the cause.

Do not delete the action ledger to force retries. An `unknown` action may have succeeded at WhatsApp.

## Backups

Back up `data`, `groups`, and `store/messages.db`. Protect `store/auth` as a credential. A backup of that directory can grant access to the linked WhatsApp session.

Before an upgrade:

```bash
npm run doctor
npm test
npm run build
```

Stop the service before copying SQLite and auth state. Restore into a single stopped instance, then start in observation mode.
