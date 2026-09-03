import { describe, expect, it } from 'vitest';

import { ReconnectBudget } from './reconnect.js';

describe('WhatsApp reconnect budget', () => {
  it('uses bounded exponential backoff and stops at the configured limit', () => {
    const budget = new ReconnectBudget({ maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 60_000, random: () => 0.5 });

    expect(budget.next()).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 });
    expect(budget.next()).toEqual({ allowed: true, attempt: 2, delayMs: 2_000 });
    expect(budget.next()).toEqual({ allowed: true, attempt: 3, delayMs: 4_000 });
    expect(budget.next()).toEqual({ allowed: false, attempt: 3 });
  });

  it('resets only when the caller confirms a stable connection', () => {
    const budget = new ReconnectBudget({ maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 1_000, random: () => 0.5 });
    budget.next();
    budget.next();

    budget.reset();

    expect(budget.next()).toEqual({ allowed: true, attempt: 1, delayMs: 500 });
  });
});
