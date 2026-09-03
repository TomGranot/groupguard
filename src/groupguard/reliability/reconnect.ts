export interface ReconnectBudgetOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  random?: () => number;
}

export type ReconnectDecision =
  | { allowed: true; attempt: number; delayMs: number }
  | { allowed: false; attempt: number };

export class ReconnectBudget {
  private attempts = 0;
  private readonly random: () => number;

  constructor(private readonly options: ReconnectBudgetOptions) {
    this.random = options.random ?? Math.random;
  }

  next(): ReconnectDecision {
    if (this.attempts >= this.options.maxAttempts) {
      return { allowed: false, attempt: this.attempts };
    }
    this.attempts += 1;
    const exponential = Math.min(
      this.options.maxDelayMs,
      this.options.baseDelayMs * 2 ** (this.attempts - 1),
    );
    const jitter = 0.75 + this.random() * 0.5;
    return {
      allowed: true,
      attempt: this.attempts,
      delayMs: Math.max(1, Math.round(exponential * jitter)),
    };
  }

  reset(): void {
    this.attempts = 0;
  }
}
