# GroupGuard

GroupGuard watches selected WhatsApp groups, applies local moderation rules, and answers service-provider requests from your directory. It uses a local Qwen model to classify a request into your closed category list. Code, provider selection, and message delivery stay deterministic.

The project runs on a remote Linux VM. The reference deployment uses [exe.dev](https://exe.dev), Ollama, `qwen3:4b`, and a dedicated WhatsApp account linked through NanoClaw's WhatsApp adapter.

> [!WARNING]
> GroupGuard uses Baileys, an unofficial WhatsApp linked-device library. WhatsApp warns that unofficial clients can put an account at risk. Use a separate account, keep message volume low, start in a test group, and accept that WhatsApp may disconnect or restrict the account.

## Behavior

- Group chats only. The ingress gate drops every direct message before content parsing, media download, an LLM call, or agent routing.
- Explicit allowlist. A malformed or missing GroupGuard config closes WhatsApp ingress.
- Semantic category matching. Exact whole-message aliases take the fast path; Qwen handles other phrasing against the same closed taxonomy.
- No mention trigger. Tagging the account does not summon an open-ended assistant.
- Two results at most. Community recommendations rank first; GroupGuard fills the remaining slot from eligible providers using deterministic rotation.
- Durable effects. SQLite records each planned reply or deletion before WhatsApp receives it. Retries cannot produce duplicate sends.
- Safe moderation rollout. Every group starts in observation mode. Deletion requires both a mature group policy and a host-level environment lock.
- Local inference. Ollama receives the incoming text and category taxonomy. The model never chooses providers, formats contacts, sends messages, or uses tools.

### Provider selection

For a recognized category:

1. No providers: send a clean “no providers listed” response.
2. One or two providers: show recommended providers first, then any remaining provider.
3. More than two providers:
   - two or more recommended providers: choose two recommended providers;
   - one recommended provider: include it and choose one other provider;
   - no recommendations: choose two providers.

The inbound WhatsApp message ID seeds each choice. A delivery retry returns the same pair; a new request can return a different pair.

## Requirements

- An exe.dev VM or another persistent Ubuntu/Debian host
- 4 vCPU, 8 GB RAM, and 25 GB disk for the reference `qwen3:4b` deployment
- Node.js 22 or newer and pnpm 10
- Ollama with `qwen3:4b`
- A WhatsApp account on a separate number
- Temporary access to WhatsApp on a phone for registration and linked-device pairing

The remote service runs after pairing. WhatsApp says the primary phone can stay offline, but linked devices disconnect if the primary app remains unused for more than 14 days. Keep the app installed, keep the account active, and open it at least once within that window.

## Quick start on exe.dev

Create a persistent VM from your local terminal:

```bash
ssh exe.dev new --name=groupguard --cpu=4 --memory=8GB --disk=25GB
ssh groupguard.exe.xyz
```

Install the host dependencies:

```bash
sudo apt-get update
sudo apt-get install -y curl git
curl -fsSL https://ollama.com/install.sh | sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
corepack enable
corepack prepare pnpm@10.34.5 --activate
ollama pull qwen3:4b
```

Clone the private repository with your preferred GitHub authentication, then install and build:

```bash
git clone git@github.com:YOUR_ACCOUNT/groupguard.git
cd groupguard
pnpm install --frozen-lockfile
pnpm build
cp .env.example .env
chmod 600 .env
```

Set `WHATSAPP_PHONE_NUMBER` in `.env` to the account number in international format, digits only. Do not commit `.env`.

### 1. Pair WhatsApp and discover the test group

Run GroupGuard once:

```bash
pnpm dev
```

Enter the pairing code in WhatsApp under **Linked devices → Link a device → Link with phone number**. GroupGuard logs each group as `Channel metadata discovered`. Copy the `platformId` for your test group; it ends in `@g.us`. Stop the process after you capture the ID.

The first boot has no valid policy, so the ingress gate drops group messages. Pairing and metadata sync still work.

### 2. Create private policy files

```bash
pnpm groupguard:init -- --group '<test-group-id>@g.us'
```

This command creates mode-`0600` files under `config/`:

- `groupguard.json`: group allowlist and behavior
- `taxonomy.json`: category IDs, titles, aliases, and examples
- `directory.json`: provider records and recommendation evidence

Git ignores all three operator files. The repository contains fictional `.example.json` files that document each schema.

Replace the starter taxonomy and directory with your data. Then run:

```bash
pnpm groupguard:doctor
pnpm test
pnpm build
```

### 3. Test in observation mode

Start the service and send requests only in the allowlisted test group. GroupGuard must ignore:

- direct messages to the account;
- messages in groups absent from `groupguard.json`;
- unknown requests and classifications below the confidence threshold;
- duplicate deliveries for the same inbound message.

Keep moderation in observation mode for at least 24 hours. Review logs for rules that would have deleted messages.

### 4. Enable moderation deletion

```bash
pnpm groupguard:enforcement -- --group '<test-group-id>@g.us' --enable
```

The command refuses to enable deletion before the configured observation period ends. It updates both the group policy and `GROUPGUARD_ENFORCEMENT_ENABLED` in `.env`. Restart the service after the change.

Return to observation mode at any time:

```bash
pnpm groupguard:enforcement -- --group '<test-group-id>@g.us' --observe
```

### 5. Run as a service

NanoClaw includes an interactive setup flow that installs a per-user systemd service on Linux:

```bash
pnpm setup
```

Run `pnpm groupguard:doctor` after a reboot or deployment. See [the deployment runbook](docs/GROUPGUARD-DEPLOYMENT.md) for service checks, backup paths, model prewarming, and recovery.

## Directory contract

GroupGuard accepts a local JSON snapshot or an HTTPS JSON endpoint. It validates the complete snapshot before an atomic cache replacement. An invalid refresh leaves the last valid snapshot active.

```json
{
  "version": "2026-01-15",
  "providers": [
    {
      "id": "northstar-repairs",
      "categoryIds": ["home-repair"],
      "name": "Northstar Repairs",
      "contacts": [
        { "label": "Website", "value": "https://example.com/providers/northstar-repairs" }
      ],
      "recommendation": {
        "quote": "Helped us with a difficult repair and communicated clearly.",
        "attribution": "Community recommendation"
      }
    }
  ]
}
```

Recommendation text belongs in structured evidence. The classifier cannot invent or rewrite it. Keep contacts limited to information the provider publishes for this purpose.

## Message shape

```text
🤖 *Home repair*

1. *Northstar Repairs*
   Website: https://example.com/providers/northstar-repairs
   _Recommended by a community member:_ “Helped us with a difficult repair and communicated clearly.”

2. *Oak & Hammer*
   Website: https://example.com/providers/oak-and-hammer
```

## Architecture

```text
WhatsApp event
  → group-only ingress and allowlist
  → local moderation decision
  → exact alias match
  → local Qwen classification when needed
  → deterministic provider selection
  → durable effect claim
  → WhatsApp reply or deletion
```

Unmatched messages stop after the directory step by default. You can opt a group into NanoClaw's general agent routing with `forwardUnmatchedToAgent`, but that expands the data and capability boundary.

## Privacy and account safety

- Store WhatsApp auth, config, directory data, caches, SQLite state, and logs outside Git.
- Give the VM and GitHub account the least access they need.
- GroupGuard does not send private moderation notices.
- Keep provider recommendation evidence reviewable and attributable without storing private chat exports.
- Back up `store/auth`, `config`, and `data/groupguard` with encryption.
- Rotate or remove access before publishing a fork.

Read [GroupGuard security](docs/GROUPGUARD-SECURITY.md) before adding a production group.

## Development

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Focused GroupGuard tests live under `src/groupguard/`. The suite covers DM rejection, allowlist failures, semantic thresholds, two-result selection, recommendation priority, moderation gates, duplicate suppression, uncertain delivery, reconnect limits, refresh fallback, and setup safety.

## NanoClaw foundation

GroupGuard v2 derives from [NanoClaw v2.3.0](https://github.com/nanocoai/nanoclaw/releases/tag/v2.3.0). NanoClaw supplies the host runtime, WhatsApp channel seam, service lifecycle, optional containerized agents, and update transaction tooling. GroupGuard owns the group-only boundary, moderation engine, directory pipeline, local classifier, and delivery ledger.

The upstream NanoClaw documentation remains in `docs/` for operators who enable general agents. GroupGuard does not require a paid hosted LLM for directory classification.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
