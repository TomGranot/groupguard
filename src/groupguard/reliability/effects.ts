import Database from 'better-sqlite3';

export type EffectStatus = 'pending' | 'delivered' | 'unknown' | 'skipped';
export type EffectKind = 'directory-reply' | 'moderation-delete' | 'moderation-observation';

export interface EffectRecord {
  effectKey: string;
  groupId: string;
  inboundId: string;
  kind: EffectKind;
  payload: string;
  status: EffectStatus;
  platformMessageId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EffectRow {
  effect_key: string;
  group_id: string;
  inbound_id: string;
  kind: EffectKind;
  payload: string;
  status: EffectStatus;
  platform_message_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: EffectRow): EffectRecord {
  return {
    effectKey: row.effect_key,
    groupId: row.group_id,
    inboundId: row.inbound_id,
    kind: row.kind,
    payload: row.payload,
    status: row.status,
    platformMessageId: row.platform_message_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EffectLedger {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = FULL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS groupguard_effects (
        effect_key TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        inbound_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'unknown', 'skipped')),
        platform_message_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS groupguard_effects_inbound
      ON groupguard_effects (group_id, inbound_id);
    `);
  }

  claim(input: {
    effectKey: string;
    groupId: string;
    inboundId: string;
    kind: EffectKind;
    payload: string;
  }): { claimed: boolean; record: EffectRecord } {
    const timestamp = new Date().toISOString();
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO groupguard_effects
          (effect_key, group_id, inbound_id, kind, payload, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(input.effectKey, input.groupId, input.inboundId, input.kind, input.payload, timestamp, timestamp);
    const record = this.get(input.effectKey);
    if (!record) throw new Error('Failed to read claimed GroupGuard effect');
    return { claimed: result.changes === 1, record };
  }

  get(effectKey: string): EffectRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM groupguard_effects WHERE effect_key = ?')
      .get(effectKey) as EffectRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  markDelivered(effectKey: string, platformMessageId?: string): void {
    this.update(effectKey, 'delivered', platformMessageId ?? null, null);
  }

  markUnknown(effectKey: string, error: string): void {
    this.update(effectKey, 'unknown', null, error.slice(0, 500));
  }

  markSkipped(effectKey: string, reason: string): void {
    this.update(effectKey, 'skipped', null, reason.slice(0, 500));
  }

  private update(effectKey: string, status: EffectStatus, platformMessageId: string | null, error: string | null): void {
    this.database
      .prepare(
        `UPDATE groupguard_effects
         SET status = ?, platform_message_id = ?, error = ?, updated_at = ?
         WHERE effect_key = ?`,
      )
      .run(status, platformMessageId, error, new Date().toISOString(), effectKey);
  }

  close(): void {
    this.database.close();
  }
}

export type AccountAction = 'reply' | 'moderation-delete' | 'moderation-dm';

export interface AccountSafetyOptions {
  budgets: Record<AccountAction, { limit: number; windowMs: number }>;
  failureThreshold: number;
  circuitCooldownMs: number;
}

export interface ActionPermit {
  allowed: boolean;
  reason?: 'budget-exhausted' | 'circuit-open';
  retryAfterMs?: number;
}

export class AccountSafetyController {
  private readonly attempts = new Map<AccountAction, number[]>();
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly options: AccountSafetyOptions) {}

  reserve(action: AccountAction, now = Date.now()): ActionPermit {
    if (this.circuitOpenUntil > now) {
      return { allowed: false, reason: 'circuit-open', retryAfterMs: this.circuitOpenUntil - now };
    }
    if (this.circuitOpenUntil !== 0) {
      this.circuitOpenUntil = 0;
      this.consecutiveFailures = 0;
    }
    const budget = this.options.budgets[action];
    const cutoff = now - budget.windowMs;
    const recent = (this.attempts.get(action) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= budget.limit) {
      this.attempts.set(action, recent);
      return {
        allowed: false,
        reason: 'budget-exhausted',
        retryAfterMs: Math.max(1, recent[0]! + budget.windowMs - now),
      };
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
    if (this.consecutiveFailures < this.options.failureThreshold) return false;
    this.circuitOpenUntil = now + this.options.circuitCooldownMs;
    return true;
  }
}
