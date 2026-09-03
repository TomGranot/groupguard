# GroupGuard security

## Trust boundary

GroupGuard accepts messages from explicitly configured WhatsApp groups. It rejects direct chats and every other group at the adapter boundary. Rejected events do not reach media download, Ollama, the NanoClaw router, or agent containers.

The local Qwen classifier receives two values: the message text and the closed taxonomy. It returns a category ID and confidence score through a JSON schema. It cannot browse, retrieve contacts, choose providers, format output, or send messages.

## Account risk

Baileys implements WhatsApp's linked-device protocol without official WhatsApp support. WhatsApp may change the protocol, log out the session, rate-limit the account, or restrict it. Use a separate account and a test group before adding a production group.

Account-safety controls include per-action rate budgets, a failure circuit breaker, bounded reconnects, and a durable effect ledger. An unknown WhatsApp result stays unknown; GroupGuard does not send the same effect again without operator review.

## Moderation locks

A delete needs all of these conditions:

- the group has completed its minimum observation period;
- `observationMode` is `false` in the group policy;
- `GROUPGUARD_ENFORCEMENT_ENABLED=true` exists in the host `.env`;
- the admin list loads successfully when admin exemptions apply;
- the account-safety budget permits the action.

GroupGuard skips deletion when it cannot verify an exempt sender's admin state.

## Data handling

Treat group IDs, sender IDs, provider contacts, recommendation evidence, message text, auth state, and logs as private data. The effect ledger stores group and inbound IDs plus immutable outbound payloads, but omits raw inbound chat text and sender identity.

Use public business contacts in the directory. Do not copy private numbers or raw group chat exports into Git. Recommendation evidence should contain the minimum text needed to support the ranking.

## Before publishing a fork

Run a full-history secret scan and inspect the patch from the public base. Search for phone-number prefixes, WhatsApp JIDs, private hostnames, regional fixtures, API keys, auth files, provider data, and message transcripts. Removing a secret from the latest commit does not remove it from Git history.

Publish only the `.example.json` files. Keep `.env`, `config/*.json`, `store/`, `data/`, and logs untracked.
