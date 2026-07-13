# GroupGuard Playground

The GroupGuard Playground is a public WhatsApp group where someone can see the product work before installing it. The first version demonstrates decisions with fixed commands. It does not delete visitor messages, run an AI agent, send private messages, or change group membership.

The activation path is short:

1. Join the group.
2. Read the pinned welcome message.
3. Run one controlled test.
4. See the rule, decision, and safety behavior.
5. Choose **Protect my group** to open the setup guide.

## Visitor experience

Pin this message in the group description or as the welcome post:

```text
Welcome to the GroupGuard Playground.

Try one command:
@GroupGuard try no-links
@GroupGuard try no-spam
@GroupGuard try keyword
@GroupGuard protect my group

These are safe simulations. This public group never sends your message to AI, never DMs you, and never deletes a message because of a demo command.
```

Keep the list short. Visitors should reach the first useful result without choosing a runtime, configuring a rule, or linking their own account.

## Safety boundary

A playground installation has a stricter profile than a private GroupGuard installation:

- Use a separate WhatsApp number that is not used for personal, business, development, or production moderation.
- Use a separate installation and private state directory.
- Register exactly one group.
- Keep the privileged `main` folder unavailable.
- Keep the AI agent, enforcement, moderation DMs, and typing indicators disabled.
- Accept only the documented commands after Unicode normalization. Extra words and unknown commands receive no response.
- Limit each visitor to one response per minute, including across restarts.
- Limit the group to six responses per minute, including across restarts and below the account-wide message budget.
- Claim every command by message ID before responding, so reconnects cannot produce duplicates.
- Do not store public message bodies in GroupGuard's message history.
- Audit the command and a keyed hash of the sender identifier. The setup command generates the private key locally.

The playground simulates guard results. Human admins remain responsible for normal group moderation. Do not advertise the first release as proof that public, automated deletion is safe.

## Set up the playground

Use a dedicated VM for the public group. A laptop is suitable for a supervised private test, but sleep, network changes, and shared credentials make it a poor public runtime.

Start with a fresh clone and a new WhatsApp number:

```bash
git clone https://github.com/TomGranot/groupguard.git groupguard-playground
cd groupguard-playground
./setup.sh
```

During setup, register only the public playground group. Give it a folder such as `playground`, not `main`. Then enable the sealed profile:

```bash
npm run playground -- status
npm run playground -- enable playground --dedicated-account
npm run doctor
npm start
```

To send visitors to a different onboarding page:

```bash
npm run playground -- enable playground --dedicated-account \
  --setup-url https://example.com/groupguard/setup
```

The command writes the playground configuration and closes the agent, enforcement, and typing gates in `.env`. The `--dedicated-account` flag records an operator assertion. GroupGuard cannot inspect whether the number is actually separate, so the operator must verify it.

Create and rotate the group invite link manually in WhatsApp. Do not automate invitations, removals, promotions, or bulk welcome messages.

## Operate it

Before publishing an invite link:

- Confirm `npm run doctor` has no failures.
- Send every command once and compare the reply with this guide.
- Confirm unknown text and repeated commands produce no response.
- Confirm the linked number and `store/auth` directory belong only to this installation.
- Assign at least two human admins who can stop abuse if GroupGuard is offline.
- Write a short group description that names the simulation and links to the privacy policy.

Review the event ledger without exposing visitor identifiers:

```bash
sqlite3 store/messages.db \
  "SELECT created_at, command, outcome FROM playground_events ORDER BY created_at DESC LIMIT 100"
```

Expected outcomes are `served`, `cooldown`, `group-budget`, `skipped`, and `unknown`. A `skipped` response means the account safety budget refused the send. An `unknown` response means the network result was uncertain; GroupGuard will not retry it.

Disable the public surface before maintenance or incident review:

```bash
npm run playground -- disable playground
```

If WhatsApp warns the account, messages appear unexpectedly, or failures repeat, stop GroupGuard, revoke the public invite link, inspect the event ledger, and check WhatsApp's Linked Devices screen. Resume only after identifying the cause.

## Learn from the first cohort

Run the first version as an assisted onboarding experiment. Watch where visitors hesitate and collect only the questions needed to improve the path. Useful measures are:

- join-to-first-command rate;
- first-command-to-setup-click rate;
- commands served, cooled down, or budget-limited;
- support questions before someone can run a test;
- account warnings, unexpected sends, and operator interventions.

Do not optimize message volume. Optimize the number of visitors who safely understand what GroupGuard would do in their own group.
