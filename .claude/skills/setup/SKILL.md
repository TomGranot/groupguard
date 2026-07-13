---
name: groupguard-setup
description: Install GroupGuard, link WhatsApp, select groups, and validate the safe moderation-only profile.
---

# GroupGuard Setup

Use the repository's guided setup instead of reproducing its steps.

## Safety rules

- Recommend a separate WhatsApp number that the user can afford to lose.
- State that GroupGuard uses an unofficial linked-device protocol because Meta's official API does not support group moderation.
- Keep observation mode on.
- Keep `GROUPGUARD_ENFORCEMENT_ENABLED=false`.
- Keep `GROUPGUARD_AGENT_ENABLED=false` unless the user asks for agent features.
- Do not request Claude credentials or Docker for moderation-only setup.
- Do not delete or replace an existing `.env`, `store/auth`, `data`, or group configuration.

## Run setup

Start the script in the foreground so the user can enter a WhatsApp pairing code and choose groups:

```bash
./setup.sh
```

The script handles dependency installation, `.env`, TypeScript build, WhatsApp linking, group selection, file permissions, and diagnostics.

If WhatsApp is already linked, the script preserves the existing session. If group configuration exists, it preserves existing entries and adds only the groups the user selects.

## Verify

Run:

```bash
npm test
npm run doctor
npm start
```

Confirm that the log contains:

```text
Connected to WhatsApp
Moderation-only mode active
```

Tell the user to leave GroupGuard running in the foreground for the first observation test. Point them to `docs/SAFE-OPERATIONS.md` before they enable enforcement or install a background service.

## Optional agent

Configure the agent only when the user asks for it. Then verify Docker, add one Anthropic credential to `.env`, build with `./container/build.sh`, set `GROUPGUARD_AGENT_ENABLED=true`, keep project access read-only, and run `npm run doctor` again.
