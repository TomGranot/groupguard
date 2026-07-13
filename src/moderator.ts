/**
 * GroupGuard Moderator
 *
 * Host-level message moderation that runs BEFORE messages reach the agent.
 * Evaluates guards, deletes violations, DMs senders, and logs everything.
 */

import { WASocket, proto } from '@whiskeysockets/baileys';
import pino from 'pino';

import { evaluateGuards, GroupGuardConfig, ModerationConfig, DEFAULT_MODERATION_CONFIG } from './guards/index.js';
import { claimModerationAction, finishModerationAction, logModeration } from './db.js';
import { ASSISTANT_NAME, ENFORCEMENT_ENABLED, WHATSAPP_ACTION_TIMEOUT_MS } from './config.js';
import { AccountSafetyController, withActionTimeout } from './account-safety.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

let sock: WASocket;
let accountSafety: AccountSafetyController;

// Admin cache: chatJid -> Set<senderJid>
const adminCache = new Map<string, Set<string>>();
// DM cooldown: senderJid -> last DM timestamp (ms)
const dmCooldowns = new Map<string, number>();
const enforcementLockWarnings = new Set<string>();

/**
 * Initialize the moderator with a WhatsApp socket.
 */
export function initModerator(
  waSock: WASocket,
  safetyController: AccountSafetyController,
): void {
  sock = waSock;
  accountSafety = safetyController;
}

/**
 * Update the admin list for a group.
 * Called when group metadata is fetched or participants change.
 */
export function updateAdminCache(chatJid: string, adminJids: string[]): void {
  adminCache.set(chatJid, new Set(adminJids));
}

/**
 * Check if a sender is an admin in a group.
 */
export function isAdmin(chatJid: string, senderJid: string): boolean {
  const admins = adminCache.get(chatJid);
  return admins?.has(senderJid) || false;
}

export function hasVerifiedAdminCache(chatJid: string): boolean {
  return adminCache.has(chatJid);
}

/**
 * Fetch and cache admin list for a group from WhatsApp.
 */
export async function refreshAdminCache(chatJid: string): Promise<void> {
  try {
    const metadata = await sock.groupMetadata(chatJid);
    const admins = metadata.participants
      .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
      .map((p) => p.id);
    updateAdminCache(chatJid, admins);
    logger.debug({ chatJid, adminCount: admins.length }, 'Admin cache refreshed');
  } catch (err) {
    logger.warn({ chatJid, err }, 'Failed to refresh admin cache');
  }
}

/**
 * Core moderation function.
 * Evaluates all guards for a message and enforces the result.
 *
 * Returns true if message was blocked, false if it passed.
 */
export async function moderateMessage(
  msg: proto.IWebMessageInfo,
  chatJid: string,
  guardConfigs: GroupGuardConfig[],
  moderationConfig: ModerationConfig | undefined,
): Promise<boolean> {
  if (!msg.key || !msg.message) return false;
  // Never mutate a message sent by the linked account. This covers manual
  // operator messages and every GroupGuard response, even if JID formats vary.
  if (msg.key.fromMe) return false;
  // Only moderate group messages
  if (!chatJid.endsWith('@g.us')) return false;
  // No guards configured for this group
  if (!guardConfigs || guardConfigs.length === 0) return false;

  const config: ModerationConfig = {
    ...DEFAULT_MODERATION_CONFIG,
    ...moderationConfig,
  };
  const senderJid = msg.key.participant || msg.key.remoteJid || '';
  const senderIsAdmin = isAdmin(chatJid, senderJid);

  const result = evaluateGuards(msg, chatJid, senderJid, guardConfigs, config, senderIsAdmin);

  if (!result.blocked) return false;

  const guardId = result.guardId || 'unknown';
  const reason = result.reason || 'Message blocked by group rules.';
  const messageId = msg.key.id || '';
  const now = new Date().toISOString();

  // A stable message ID is required for safe at-most-once enforcement.
  if (!messageId) {
    logModeration({
      chat_jid: chatJid,
      sender_jid: senderJid,
      guard_id: guardId,
      action: 'skipped_missing_message_id',
      reason,
      message_id: '',
      timestamp: now,
    });
    logger.warn({ chatJid, senderJid, guardId }, 'Moderation skipped because the event has no message ID');
    return false;
  }

  const actionKey = `moderation:${chatJid}:${messageId}`;
  const effectiveObservation = config.observationMode || !ENFORCEMENT_ENABLED;
  const plannedAction = effectiveObservation ? 'observe' : 'delete';

  // Claim before any network call. Replayed events are ignored permanently,
  // including ambiguous timeouts where WhatsApp may have applied the action.
  const claimed = claimModerationAction({
    action_key: actionKey,
    chat_jid: chatJid,
    message_id: messageId,
    sender_jid: senderJid,
    guard_id: guardId,
    action: plannedAction,
    reason,
    timestamp: now,
  });
  if (!claimed) {
    logger.debug({ actionKey }, 'Duplicate moderation event ignored');
    return false;
  }

  if (effectiveObservation) {
    const action = config.observationMode ? 'logged' : 'enforcement_locked';
    logModeration({
      chat_jid: chatJid,
      sender_jid: senderJid,
      guard_id: guardId,
      action,
      reason,
      message_id: messageId,
      timestamp: now,
    });
    finishModerationAction(actionKey, 'completed');

    if (!config.observationMode && !enforcementLockWarnings.has(chatJid)) {
      enforcementLockWarnings.add(chatJid);
      logger.warn(
        { chatJid },
        'Group requested enforcement, but the operator safety lock is off; continuing in observation mode',
      );
    }
    logger.info(
      { chatJid, senderJid, guardId, reason, action },
      'Guard violation detected without enforcement',
    );
    return false;
  }

  // If admins are exempt, a failed metadata fetch must never turn an admin into
  // a moderation target. Wait for a verified cache and fail open meanwhile.
  if (config.adminExempt && !hasVerifiedAdminCache(chatJid)) {
    const error = 'Admin list has not been verified';
    finishModerationAction(actionKey, 'skipped', error);
    logModeration({
      chat_jid: chatJid,
      sender_jid: senderJid,
      guard_id: guardId,
      action: 'skipped_unverified_admins',
      reason,
      message_id: messageId,
      timestamp: now,
    });
    logger.warn({ chatJid, senderJid, guardId }, `${error}; moderation failed open`);
    return false;
  }

  const permit = accountSafety.reserve('moderation');
  if (!permit.allowed) {
    const error = `Account safety ${permit.reason}; retry window ${permit.retryAfterMs || 0}ms`;
    finishModerationAction(actionKey, 'skipped', error);
    logModeration({
      chat_jid: chatJid,
      sender_jid: senderJid,
      guard_id: guardId,
      action: 'skipped_safety_budget',
      reason,
      message_id: messageId,
      timestamp: now,
    });
    logger.warn({ chatJid, guardId, permit }, 'Moderation paused by account safety controller');
    return false;
  }

  // Enforce: delete the message
  try {
    await withActionTimeout(
      sock.sendMessage(chatJid, { delete: msg.key }),
      WHATSAPP_ACTION_TIMEOUT_MS,
    );
    accountSafety.recordSuccess();
    finishModerationAction(actionKey, 'completed');
    logModeration({
      chat_jid: chatJid,
      sender_jid: senderJid,
      guard_id: guardId,
      action: 'deleted',
      reason,
      message_id: messageId,
      timestamp: now,
    });
    logger.info({ chatJid, senderJid, guardId }, 'Message deleted by guard');
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const circuitOpened = accountSafety.recordFailure();
    finishModerationAction(actionKey, 'unknown', error);
    logModeration({
      chat_jid: chatJid,
      sender_jid: senderJid,
      guard_id: guardId,
      action: 'delete_status_unknown',
      reason,
      message_id: messageId,
      timestamp: now,
    });
    logger.error({ chatJid, senderJid, guardId, err }, 'Failed to delete message');
    if (circuitOpened) logger.error(accountSafety.snapshot(), 'Account safety circuit opened');
    return false;
  }

  // Sender notifications are off by default because unsolicited DMs create
  // account load and can surprise group members.
  if (config.notifyOnDelete) {
    await dmSender(senderJid, reason, config.dmCooldownSeconds);
  }

  return true;
}

/**
 * DM the sender with the violation reason (with cooldown to prevent spam).
 */
async function dmSender(senderJid: string, reason: string, cooldownSeconds: number): Promise<void> {
  const now = Date.now();
  const lastDm = dmCooldowns.get(senderJid) || 0;

  if (now - lastDm < cooldownSeconds * 1000) {
    logger.debug({ senderJid }, 'DM cooldown active, skipping');
    return;
  }

  const permit = accountSafety.reserve('moderation-dm');
  if (!permit.allowed) {
    logger.warn({ senderJid, permit }, 'Moderation DM skipped by account safety controller');
    return;
  }

  try {
    await withActionTimeout(
      sock.sendMessage(senderJid, { text: `${ASSISTANT_NAME}: ${reason}` }),
      WHATSAPP_ACTION_TIMEOUT_MS,
    );
    accountSafety.recordSuccess();
    dmCooldowns.set(senderJid, now);
    logger.debug({ senderJid }, 'Violation DM sent');
  } catch (err) {
    const circuitOpened = accountSafety.recordFailure();
    logger.warn({ senderJid, err }, 'Failed to DM sender');
    if (circuitOpened) logger.error(accountSafety.snapshot(), 'Account safety circuit opened');
  }
}
