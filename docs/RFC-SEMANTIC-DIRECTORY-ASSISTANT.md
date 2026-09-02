# RFC: Semantic directory assistant

- Status: Proposed
- Scope: Design only
- Target delivery: An opt-in GroupGuard customization skill

## Reader and purpose

This RFC is for a GroupGuard operator who runs a trusted service directory and wants the bot to answer service-provider requests inside selected WhatsApp groups.

It defines the behavior, data boundaries, deployment profile, and acceptance criteria. It does not add runtime code or change GroupGuard's defaults.

## Problem

Community groups repeat the same request in many forms: “Does anyone know a mover?”, “I need help installing an air conditioner,” or a single category word. A literal keyword filter misses paraphrases. Sending every message and the whole provider directory to a language model adds latency, cost, and privacy risk.

The assistant needs two narrow forms of semantic classification:

1. Classify a service request into a closed directory category.
2. Classify historical recommendation messages into that same category list.

The website remains the source of truth for provider identity and contact details. Group history supplies recommendation evidence and ranking signals. The bot does not invent, repair, or infer contact details.

## Reference deployment

The Young Dads deployment proved the request-routing half of this design with a linked WhatsApp number, NanoClaw, an Ubuntu VM, Ollama, and `qwen3:4b`. It loads a website export once, resolves exact category aliases without model inference, and uses Qwen for unresolved natural-language requests.

The reference VM profile is:

| Component | Reference choice |
| --- | --- |
| Host | Ubuntu 24.04 VM on exe.dev |
| Runtime | Node.js 22, Docker, systemd |
| Local inference | Ollama with `qwen3:4b` |
| Memory | 8 GB RAM |
| Model residency | `keep_alive: 25h`, with startup prewarm |
| WhatsApp | Separate linked-device account |
| Directory refresh | Daily, atomic JSON refresh |

These choices form a known-good profile, not a GroupGuard requirement. Another operator may use a compatible local classifier and supervisor.

## Goals

- Answer service-provider requests in explicitly enabled groups.
- Match paraphrases against a closed, versioned category taxonomy.
- Prefer providers backed by recommendation text from the same community.
- Return no more than two provider records from the website directory.
- Keep routine matches fast through exact aliases and a warm local model.
- Preserve enough provenance to review each historical recommendation.

## Non-goals

- General chat assistance or mention-triggered replies.
- Replies to private messages.
- Web search for providers that do not exist in the configured directory.
- Automatic publication of uncertain historical recommendations.
- Changes to moderation guards or their observation-first safety controls.
- A second copy of the website database inside an LLM prompt.

## User-visible behavior

The directory assistant evaluates plain-text messages after host-level moderation passes. It does not require an `@GroupGuard` mention. A mention by itself does not invoke the directory assistant.

### No matching providers

If the classifier finds a category but the website export contains no providers, the bot sends one short response saying that the website has no providers for that service.

### Providers with recommendation evidence

If two or more providers have approved recommendation evidence, the bot selects two of those providers at random.

If exactly one provider has approved recommendation evidence, the bot lists that provider first and selects one different provider at random from the remaining category records.

### Providers without recommendation evidence

If the category has providers but none has approved recommendation evidence, the bot selects up to two at random.

### Reply contract

- Use a bold title.
- Include a `🤖` marker.
- Return at most two providers.
- Copy names and contact fields from the current website export.
- Include an approved recommendation excerpt when one exists.
- Keep website links and phone numbers in their original directory form.
- Do not include the recommending member's name or phone number.

Sanitized example:

```text
🤖 *Recommendations for moving services*

1. <provider name>
   <website contact fields>
   “<approved recommendation excerpt>”

2. <provider name>
   <website contact fields>
```

## Routing pipeline

```text
WhatsApp event
  -> reject private chats and non-allowlisted groups
  -> ignore protocol events, reactions, edits, and bot messages
  -> run GroupGuard moderation
  -> normalize the text
  -> exact whole-message category or alias match
  -> otherwise classify against category IDs with the local LLM
  -> reject no-match and low-confidence results
  -> retrieve providers by canonical category ID
  -> rank with approved same-group recommendation evidence
  -> render one stored reply
  -> send once to the source group
```

### Exact alias path

The checked-in taxonomy maps canonical category IDs to labels and reviewed aliases. The resolver normalizes Unicode, whitespace, punctuation, and bidirectional control characters, then requires whole-message equality. It must not treat an alias inside a longer sentence as a keyword hit.

Each alias change ships with positive, negative, and collision tests. A correction such as a missed synonym creates a candidate alias and a regression test. An operator reviews it before publication.

### Semantic path

The semantic classifier receives:

- The normalized user message.
- The canonical category IDs, names, and short descriptions.
- A small set of reviewed examples for ambiguous categories.

It returns structured data only:

```json
{
  "categoryId": "moving-services",
  "match": "llm",
  "confidence": "high"
}
```

The model never chooses providers. Provider retrieval and reply rendering stay deterministic after category selection.

## Historical recommendation index

The proposed history layer classifies each eligible message once in a background job. Live requests query the resulting index instead of replaying group history through the model.

### Eligible sources

- Messages from the same registered WhatsApp group.
- An operator-supplied export for that group.

The importer rejects direct messages, status broadcasts, other groups, protocol events, and bot-authored content. It records the source group for every candidate and never reuses evidence across groups.

### Candidate record

```json
{
  "providerKey": "directory-provider-id",
  "categoryId": "moving-services",
  "sourceGroupKey": "opaque-group-key",
  "sourceMessageId": "opaque-message-id",
  "quoteExcerpt": "Approved excerpt from the source message",
  "classification": "recommendation",
  "reviewStatus": "pending",
  "createdAt": "ISO-8601 timestamp"
}
```

The production record may encrypt source identifiers at rest. Logs should use opaque hashes instead of WhatsApp JIDs.

### Matching history to the website

The indexer may propose a provider match from a name, URL, or contact value found in the message. It may attach evidence only after it resolves one stable provider key from the website export.

If no website record matches, the candidate stays pending. The bot does not send the historical contact value as a substitute. An operator can add the provider to the website, refresh the export, and approve the match.

### Review workflow

The first version should expose a local CLI review queue:

```text
pending candidate -> inspect source excerpt -> approve, edit, or reject
```

Approval stores the excerpt, provider key, category ID, source group, and reviewer timestamp. A new website export must not erase approved evidence when the provider key remains stable.

## Data boundaries

| Data | Storage rule | Model access |
| --- | --- | --- |
| Website provider records | Local versioned export | Never sent during request classification |
| Category taxonomy | Checked-in configuration | Sent to the classifier |
| Current request text | Memory for classification, minimal diagnostic log | Sent to the classifier |
| Group history | Group-scoped SQLite or encrypted local store | Processed once by the indexer |
| Recommendation excerpt | Store after review | Used only to render same-group replies |
| WhatsApp auth state | Existing host-only GroupGuard store | Never available to the model |
| Private-message content | Do not store for this feature | Never available to the model |

Retention must be configurable per group. Deleting a source message or provider should create a tombstone so refresh jobs do not restore retired evidence.

## GroupGuard integration boundary

This capability belongs in an opt-in skill rather than GroupGuard core. The skill should add one narrow responder between moderation and the optional general agent.

The future implementation should preserve these boundaries:

- GroupGuard's existing allowlist decides which group events enter the pipeline.
- Host-level moderation runs before directory routing.
- Directory replies stay independent from the optional Claude agent.
- Each enabled group receives its own taxonomy, directory source, evidence index, and retention settings.
- The directory responder cannot call GroupGuard's mutation tools.
- The general agent cannot approve recommendation candidates.

The core installation should behave exactly as it does today until an operator applies the skill and enables a group.

## Configuration sketch

This sketch documents the intended contract. It does not define a committed schema.

```json
{
  "directoryAssistant": {
    "enabled": true,
    "replyToPrivateMessages": false,
    "replyOnMention": false,
    "directoryPath": "data/directories/community.json",
    "taxonomyPath": "data/directories/taxonomy.json",
    "model": "qwen3:4b",
    "ollamaBaseUrl": "http://127.0.0.1:11434",
    "keepAlive": "25h",
    "maxProviders": 2,
    "historyIndexing": {
      "enabled": true,
      "reviewRequired": true,
      "retentionDays": 365
    }
  }
}
```

## Reliability rules

- Use the inbound WhatsApp message ID as the deduplication boundary.
- Persist the final rendered reply before sending it.
- Retry the same stored payload with the same outbound key after an ambiguous failure.
- Mark the reply sent only after the WhatsApp client accepts it.
- Bound retries and use exponential backoff with jitter.
- Refresh directory data into a temporary file, validate it, then replace the active snapshot atomically.
- Fail closed when the classifier, taxonomy, or directory snapshot is unavailable.

Random provider selection happens before the bot persists the reply. A retry sends the same two providers rather than drawing a new pair.

## Local model operation

The reference setup keeps `qwen3:4b` resident for 25 hours and prewarms the shared classification prompt after service startup. A daily directory refresh then runs against a warm model.

The classifier should expose a short timeout and a health check. Exact aliases must continue to resolve without the model. Unresolved natural-language requests should receive no reply while inference is unavailable.

## Security considerations

- Treat every WhatsApp message and historical excerpt as untrusted input.
- Constrain model output to a category ID and confidence value.
- Do not expose browser, shell, filesystem, or GroupGuard IPC tools to the classifier.
- Bind Ollama to localhost or a private network interface.
- Keep auth state, directory exports, evidence stores, and logs outside container mounts available to general agents.
- Redact phone numbers, JIDs, message text, and provider contacts from routine logs.
- Require an operator action outside WhatsApp to approve history-derived evidence.

The feature must never send a direct message, even when a member contacts the bot account. GroupGuard may record chat metadata for discovery, but this responder must not store or process private-message content.

## Observability

Record structured events without raw provider contacts or message bodies:

| Event | Required fields |
| --- | --- |
| Request classified | opaque group, message ID hash, category ID, route, latency |
| Request ignored | opaque group, reason code |
| Reply prepared | reply ID, category ID, provider count, evidence count |
| Reply sent | reply ID, attempt count, elapsed time |
| History candidate | opaque group, category ID, match state, review status |
| Refresh completed | snapshot version, category count, provider count |

The `route` value should distinguish `canonical`, `alias`, `llm`, and `none`. This makes missed aliases and semantic errors measurable without copying message text into logs.

## Evaluation plan

Maintain a frozen, sanitized evaluation set with:

- Canonical category names and accepted aliases.
- Natural-language paraphrases in each supported language.
- Non-service conversation that must produce `none`.
- Ambiguous messages that must stay silent.
- Prompt-injection attempts that must not escape the category schema.
- Ranking cases for zero, one, two, and more than two recommended providers.
- Duplicate-delivery and ambiguous-send cases.
- Private-message and non-allowlisted-group cases.

Measure category accuracy, false-positive rate, exact-path latency, semantic-path latency, duplicate replies, and pending-review volume.

## Delivery phases

### Phase 1: Skill contract and fixtures

Write an `add-directory-assistant` skill, sanitized example files, schema validators, and a no-network test fixture. The skill should show its planned file changes before applying them.

### Phase 2: Request routing

Add the directory export, taxonomy, exact alias resolver, Qwen fallback, provider selection, and group-only reply renderer. Start in a test group with production groups disabled.

### Phase 3: History indexing

Add the background candidate extractor, stable provider matching, review queue, group-scoped evidence store, and retention controls.

### Phase 4: Production hardening

Add restart recovery, directory refresh scheduling, prewarm, metrics, backup guidance, and a production rollout checklist.

## Acceptance criteria

The implementation can leave proposal status after it proves all of these behaviors:

- Private messages never enter classification and never receive a response.
- Messages from disabled groups never enter classification.
- Mentions alone never trigger a directory response.
- Exact aliases resolve without a model request.
- Natural-language requests map only to the closed taxonomy.
- Provider names and contacts come from the active website export.
- History evidence never crosses group boundaries.
- Unreviewed history never changes provider ranking or reply text.
- Replies contain at most two providers and follow the stated ranking rules.
- Duplicate inbound events produce one outbound reply.
- A send retry preserves the rendered providers and wording.
- Model or directory failures keep the bot silent and emit a reason code.

## Open decisions

- Choose the history retention default and deletion workflow.
- Decide whether candidate review belongs in a CLI only or also in the main admin chat.
- Define confidence calibration for each supported language.
- Decide whether groups may share one taxonomy while keeping separate evidence indexes.
- Define the provider-key migration rule when the website changes slugs or IDs.

## Out of scope for this PR

This PR does not add database tables, configuration fields, message handlers, model calls, services, sample provider data, or deployment scripts. A later implementation PR should begin with the opt-in skill described in Phase 1.
