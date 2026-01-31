import { proto } from '@whiskeysockets/baileys';

/**
 * Result of a guard evaluation.
 * If blocked=true, the message should be deleted and the sender notified.
 */
export interface GuardResult {
  blocked: boolean;
  reason?: string;
  guardId?: string;
}

/**
 * A guard evaluates a single message and decides whether to block it.
 * Guards are pure functions — they don't delete messages or send DMs.
 */
export interface Guard {
  id: string;
  name: string;
  description: string;
  evaluate: (ctx: GuardContext) => GuardResult;
}

/**
 * Context passed to each guard for evaluation.
 */
export interface GuardContext {
  msg: proto.IWebMessageInfo;
  chatJid: string;
  senderJid: string;
  contentType: string | undefined;
  textContent: string;
  config: GroupGuardConfig;
  isAdmin: boolean;
  now: Date;
}

/**
 * Configuration for a single guard instance on a group.
 */
export interface GroupGuardConfig {
  guardId: string;
  enabled: boolean;
  params?: Record<string, unknown>;
}

/**
 * Top-level moderation configuration for a group.
 */
export interface ModerationConfig {
  observationMode: boolean;
  adminExempt: boolean;
  dmCooldownSeconds: number;
}

export const DEFAULT_MODERATION_CONFIG: ModerationConfig = {
  observationMode: true,
  adminExempt: true,
  dmCooldownSeconds: 60,
};
