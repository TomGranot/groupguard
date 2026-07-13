export type AccountAction = 'message' | 'moderation' | 'moderation-dm';

interface ActionBudget {
  limit: number;
  windowMs: number;
}

export interface AccountSafetyConfig {
  budgets: Record<AccountAction, ActionBudget>;
  failureThreshold: number;
  circuitCooldownMs: number;
}

export interface ActionPermit {
  allowed: boolean;
  reason?: 'budget-exhausted' | 'circuit-open';
  retryAfterMs?: number;
}

export interface AccountSafetySnapshot {
  circuitOpen: boolean;
  circuitOpenUntil: string | null;
  consecutiveFailures: number;
  attemptsInWindow: Record<AccountAction, number>;
}

/**
 * One safety boundary for every user-visible WhatsApp mutation. A reservation
 * consumes budget before the network call so failures cannot create retry
 * storms. Repeated failures pause every outbound action for a cool-down period.
 */
export class AccountSafetyController {
  private readonly attempts = new Map<AccountAction, number[]>();
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly config: AccountSafetyConfig) {}

  reserve(action: AccountAction, now = Date.now()): ActionPermit {
    if (this.circuitOpenUntil > now) {
      return {
        allowed: false,
        reason: 'circuit-open',
        retryAfterMs: this.circuitOpenUntil - now,
      };
    }

    if (this.circuitOpenUntil !== 0) {
      this.circuitOpenUntil = 0;
      this.consecutiveFailures = 0;
    }

    const budget = this.config.budgets[action];
    const cutoff = now - budget.windowMs;
    const recent = (this.attempts.get(action) || []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= budget.limit) {
      const retryAfterMs = Math.max(1, recent[0] + budget.windowMs - now);
      this.attempts.set(action, recent);
      return { allowed: false, reason: 'budget-exhausted', retryAfterMs };
    }

    recent.push(now);
    this.attempts.set(action, recent);
    return { allowed: true };
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  recordFailure(now = Date.now()): boolean {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures < this.config.failureThreshold) return false;

    this.circuitOpenUntil = now + this.config.circuitCooldownMs;
    return true;
  }

  snapshot(now = Date.now()): AccountSafetySnapshot {
    const attemptsInWindow = {} as Record<AccountAction, number>;
    for (const action of ['message', 'moderation', 'moderation-dm'] as const) {
      const budget = this.config.budgets[action];
      const cutoff = now - budget.windowMs;
      attemptsInWindow[action] = (this.attempts.get(action) || []).filter(
        (timestamp) => timestamp > cutoff,
      ).length;
    }

    return {
      circuitOpen: this.circuitOpenUntil > now,
      circuitOpenUntil: this.circuitOpenUntil > now
        ? new Date(this.circuitOpenUntil).toISOString()
        : null,
      consecutiveFailures: this.consecutiveFailures,
      attemptsInWindow,
    };
  }
}

export async function withActionTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`WhatsApp action timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
