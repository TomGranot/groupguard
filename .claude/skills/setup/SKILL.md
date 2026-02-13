---
name: groupguard-setup
description: Run initial GroupGuard setup. Use when user wants to install dependencies, authenticate WhatsApp, register their main channel, or start the background services. Triggers on "groupguard setup", "setup groupguard", "install groupguard", or first-time setup requests.
---

# GroupGuard Setup

Run all commands automatically. Only pause when user action is required (scanning QR codes).

**UX Note:** Use `AskUserQuestion` only for multiple-choice questions. Never use it for free-text input like group names or phone numbers — use plain text output and wait for the user to type their answer instead.

## 1. Install Dependencies

```bash
npm install
```

## 2. Check Docker

```bash
command -v docker &>/dev/null && docker info >/dev/null 2>&1 && echo "Docker: installed and running" || echo "Docker: NOT available"
```

**If Docker is running:** Continue to the next step.

**If Docker is not available:**

Tell the user:
> GroupGuard requires Docker. Please install it:
>
> - **macOS**: Install [Docker Desktop](https://docker.com/products/docker-desktop)
> - **Linux**: Install [Docker Engine](https://docs.docker.com/engine/install/)
>
> Make sure Docker is running, then let me know.

Wait for confirmation, then re-check.

## 3. Configure Claude Authentication

Check if a token is already available:

```bash
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] && echo "OAUTH_TOKEN_PRESENT" || echo "NO_TOKEN"
[ -n "$ANTHROPIC_API_KEY" ] && echo "API_KEY_PRESENT" || echo "NO_API_KEY"
[ -f .env ] && echo "ENV_FILE_EXISTS" || echo "NO_ENV_FILE"
```

**If `OAUTH_TOKEN_PRESENT` and `ENV_FILE_EXISTS`:** Tell the user their Claude Code subscription will be used. Skip to step 4.

**If `API_KEY_PRESENT` and `ENV_FILE_EXISTS`:** Tell the user their API key will be used. Skip to step 4.

**If a token/key is present in the environment but NO `.env` file exists:** You MUST still write the `.env` file. Background services (launchd/systemd) don't inherit shell environment variables, so the `.env` file is required for the app to work when running as a service. Write the detected value to `.env`:

```bash
# For OAuth token:
echo "CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN" > .env

# For API key:
echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" > .env
```

Tell the user: "I detected your key in the environment and saved it to `.env` so it works when running as a service."

**If neither is present**, use `AskUserQuestion`:

> How do you want to authenticate with Claude?

Options:
1. **Claude Code subscription (Recommended)** — Uses your Pro/Max subscription. No API key needed.
2. **Anthropic API key** — Pay-per-token API key.

### Option 1: Claude Subscription

Tell the user:
> Open another terminal and run:
> ```
> claude setup-token
> ```
> A browser will open for you to log in. Once done, paste the token here.

When they provide the token, save it:
```bash
echo "CLAUDE_CODE_OAUTH_TOKEN=<token>" > .env
```

### Option 2: API Key

Ask if they have a key or need to create one at https://console.anthropic.com/

When they provide a key:
```bash
echo 'ANTHROPIC_API_KEY=<key>' > .env
```

## 4. Build Container Image

Build the agent container:

```bash
./container/build.sh
```

Verify the build:

```bash
docker run --rm --entrypoint echo groupguard-agent:latest "Container OK"
```

## 5. WhatsApp Authentication

**USER ACTION REQUIRED**

**IMPORTANT:** Run this command in the **foreground**. The QR code is multi-line ASCII art that must be displayed in full. Do NOT run in background or truncate output.

Tell the user exactly this:
> A QR code will appear. Here's what to do:
>
> 1. **If the QR code looks cut off**, press **Ctrl+O** to expand the output panel so you can see the full code
> 2. On your phone, open **WhatsApp → Settings → Linked Devices → Link a Device**
> 3. **Scan the QR code** with your phone camera
> 4. Once it says "Successfully authenticated", press **Esc** to close the expanded view and we'll continue

Run with Bash tool timeout of 120000ms. Do NOT use the `timeout` shell command (not available on macOS).

```bash
npm run auth
```

Wait for "Successfully authenticated" then continue.

If it says "Already authenticated", skip to the next step.

## 6. Set Up Your Admin Group

GroupGuard uses a solo WhatsApp group as your admin control panel. This is where you'll manage the bot — no trigger word needed, every message goes straight to Claude.

Tell the user:
> Now we need to set up your admin group. This is a **solo WhatsApp group** (just you) where you control GroupGuard.
>
> **If you already have a solo group you want to use**, tell me its name.
>
> **If you don't have one yet**, go create one now:
> 1. Open WhatsApp
> 2. Tap **New Group**
> 3. Add any contact, create the group, then remove them (WhatsApp requires at least one other person to create a group)
> 4. Name it something like **"GroupGuard Admin"**
> 5. Tell me when it's ready

Wait for the user to say they're ready or give you a group name.

### 6a. Sync groups from WhatsApp

Build and start the app briefly to sync group metadata. Use the Bash tool's timeout parameter (15000ms) — do NOT use the `timeout` shell command.

```bash
npm run build
```

Then run briefly (set Bash tool timeout to 15000ms):
```bash
npm run dev
```

### 6b. Find the group

Query the database for the group. If the user told you a name, search for it:

```bash
sqlite3 store/messages.db "SELECT jid, name FROM chats WHERE name LIKE '%GROUP_NAME%' AND jid LIKE '%@g.us'"
```

If they didn't give a specific name, list recent groups:

```bash
sqlite3 store/messages.db "SELECT jid, name FROM chats WHERE jid LIKE '%@g.us' AND jid != '__group_sync__' ORDER BY last_message_time DESC LIMIT 20"
```

Show the results as a simple numbered list and ask: "Which one is your admin group? Give me the number."

Do NOT use `AskUserQuestion` for this — just print the list and wait for the user to type a number or name.

If the group doesn't appear, tell the user to send a message in the group first (this ensures WhatsApp syncs it), then re-run the brief `npm run dev` and query again.

### 6c. Write the configuration

Once you have the JID, write the config.

**CRITICAL: `requiresTrigger` MUST be `false` for the admin group.** This means messages in the admin group do NOT need the `@GroupGuard` prefix — all messages go directly to Claude.

```bash
mkdir -p data
```

Write `data/registered_groups.json` using the Write tool (NOT Bash). Replace `JID_HERE` with the actual JID:

```json
{
  "JID_HERE": {
    "name": "main",
    "folder": "main",
    "trigger": "@GroupGuard",
    "added_at": "CURRENT_ISO_TIMESTAMP",
    "requiresTrigger": false
  }
}
```

Double-check: `requiresTrigger` must be `false`, not `true`.

Ensure the groups folder exists:
```bash
mkdir -p groups/main/logs
```

## 7. Build and Run

Build the project:
```bash
npm run build
```

Start GroupGuard (run in background so the user can interact here):
```bash
npm run dev
```

**Once it connects**, tell the user ONLY this — nothing else:

> **Setup complete! Go send a message in your admin group to test it.**
>
> No prefix needed — just type normally.

Wait for the user to confirm it works. Only AFTER they confirm, mention:
> When you're done testing, press **Ctrl+C** to stop. To run permanently, ask me to set up a background service.

## Troubleshooting

**Container agent fails**:
- Make sure your container runtime is running
- Check container logs: `cat groups/main/logs/container-*.log | tail -50`

**No response to messages**:
- In admin group: all messages are processed, no prefix needed
- In other groups: messages must start with `@GroupGuard`

**WhatsApp disconnected**:
- Run `npm run auth` to re-authenticate
