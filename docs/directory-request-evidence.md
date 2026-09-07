# Directory request evidence

Natural-language directory routing now requires a service phrase in the configured taxonomy and a provider-seeking request form. The model receives only the supported candidate categories, and the responder rejects a category outside that set even if the classifier returns high confidence. Exact whole-message category commands still work without the model.

## Detect

Review your taxonomy's `aliases` before updating. A category with a broad title and few aliases may previously have relied on the model to infer an unstated service. Those requests now stay silent. The request-form policy covers English and Hebrew; other languages need corresponding policy cases before rollout.

## Why

Closed category IDs alone do not prevent the model from choosing a valid but unrelated category. Generic contact preferences must not establish the requested service. Evidence matching excludes generic Hebrew words from partial alias matching, while preserving complete service phrases and Hebrew prefixes.

## Update

Add specific service synonyms and common singular/plural forms to each category's `aliases`. For example, a moving category can include `movers`, `moving company`, and `relocate`. Use `examples` to clarify intent for the model, not as a replacement for service aliases. Do not add generic contact words as standalone aliases.

The provider selector also removes explicitly excluded names before ranking recommendations. It recognizes English and Hebrew exclusion forms and alternate names in parentheses. It does not infer availability or interpret arbitrary preferences about methods, prices, or locations. If all providers are excluded, the response says no other matching providers are listed.

## Verify

Run `pnpm exec vitest run src/groupguard` and `pnpm run typecheck`. Before enabling production groups, replay a private, labeled sample with your taxonomy and configured model. Check supported requests, unsupported services, recommendations being given, discussion, and named exclusions. Keep private messages and provider contacts out of contributed tests; use synthetic fixtures.

## Roll back

Restore the previous reviewed code and taxonomy snapshot together, rebuild, and restart the service. Test in a restricted group before restoring production scope; the previous code lacks the candidate-evidence safeguard.
