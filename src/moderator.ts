/**
 * GroupGuard Moderator
 *
 * Host-level message moderation that runs BEFORE messages reach the agent.
 * Evaluates guards, deletes violations, DMs senders, and logs everything.
 */

import { WASocket, proto } from '@whiskeysockets/baileys';
import pino from 'pino';

import { evaluateGuards, GroupGuardConfig, ModerationConfig, DEFAULT_MODERATION_CONFIG } from './guards/index.js';
import { logModeration } from './db.js';
import { ASSISTANT_NAME } from './config.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

let sock: WASocket;

// Admin cache: chatJid -> Set<senderJid>
const adminCache = new Map<string, Set<string>>();
// DM cooldown: senderJid -> last DM timestamp (ms)
const dmCooldowns = new Map<string, number>();

/**
 * Initialize the moderator with a WhatsApp socket.
 */
export function initModerator(waSock: WASocket): void {
  sock = waSock;
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
  // Don't moderate the bot's own outgoing responses (prefixed with assistant name)
  // Note: fromMe is true for ALL messages from this WhatsApp account (including the owner),
  // so we can't use fromMe alone — we check message content to identify bot responses.
  if (msg.key.fromMe) {
    const m = msg.message;
    const text = m?.conversation || m?.extendedTextMessage?.text || '';
    if (text.startsWith(`${ASSISTANT_NAME}:`)) return false;
  }
  // Only moderate group messages
  if (!chatJid.endsWith('@g.us')) return false;
  // No guards configured for this group
  if (!guardConfigs || guardConfigs.length === 0) return false;

  const config = moderationConfig || DEFAULT_MODERATION_CONFIG;
  const senderJid = msg.key.participant || msg.key.remoteJid || '';
  const senderIsAdmin = isAdmin(chatJid, senderJid);

  const result = evaluateGuards(msg, chatJid, senderJid, guardConfigs, config, senderIsAdmin);

  if (!result.blocked) return false;

  const guardId = result.guardId || 'unknown';
  const reason = result.reason || 'Message blocked by group rules.';

  // Log the violation (always, regardless of observation mode)
  logModeration({
    chat_jid: chatJid,
    sender_jid: senderJid,
    guard_id: guardId,
    action: config.observationMode ? 'logged' : 'deleted',
    reason,
    message_id: msg.key.id || '',
    timestamp: new Date().toISOString(),
  });

  if (config.observationMode) {
    logger.info(
      { chatJid, senderJid, guardId, reason },
      'Guard violation detected (observation mode — not enforcing)',
    );
    return false; // Don't block in observation mode
  }

  // Enforce: delete the message
  try {
    await sock.sendMessage(chatJid, { delete: msg.key });
    logger.info({ chatJid, senderJid, guardId }, 'Message deleted by guard');
  } catch (err) {
    logger.error({ chatJid, senderJid, guardId, err }, 'Failed to delete message');
  }

  // DM the sender with reason (with cooldown)
  await dmSender(senderJid, reason, config.dmCooldownSeconds);

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

  try {
    await sock.sendMessage(senderJid, {
      text: `${ASSISTANT_NAME}: ${reason}`,
    });
    dmCooldowns.set(senderJid, now);
    logger.debug({ senderJid }, 'Violation DM sent');
  } catch (err) {
    logger.warn({ senderJid, err }, 'Failed to DM sender');
  }
}

