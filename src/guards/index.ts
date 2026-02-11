import { Guard, GuardContext, GuardResult, GroupGuardConfig, ModerationConfig, DEFAULT_MODERATION_CONFIG } from './types.js';
import { contentGuards } from './content.js';
import { propertyGuards } from './property.js';
import { behavioralGuards } from './behavioral.js';
import { keywordGuards } from './keyword.js';
import { proto } from '@whiskeysockets/baileys';

// Registry of all available guards
const guardRegistry = new Map<string, Guard>();

// Register all built-in guards
for (const guard of [...contentGuards, ...propertyGuards, ...behavioralGuards, ...keywordGuards]) {
  guardRegistry.set(guard.id, guard);
}

/**
 * Get a guard by ID.
 */
export function getGuard(id: string): Guard | undefined {
  return guardRegistry.get(id);
}

/**
 * List all available guards with their metadata.
 */
export function listGuards(): Array<{ id: string; name: string; description: string }> {
  return Array.from(guardRegistry.values()).map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
  }));
}

/**
 * Extract the Baileys content type from a message.
 */
function getContentType(msg: proto.IWebMessageInfo): string | undefined {
  if (!msg.message) return undefined;
  // Baileys message types are keys on the message object
  const keys = Object.keys(msg.message).filter(
    (k) => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage',
  );
  return keys[0];
}

/**
 * Extract text content from any message type.
 */
function extractTextContent(msg: proto.IWebMessageInfo): string {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

/**
 * Evaluate all enabled guards for a message.
 * Returns the first blocking result, or a pass result.
 */
export function evaluateGuards(
  msg: proto.IWebMessageInfo,
  chatJid: string,
  senderJid: string,
  guardConfigs: GroupGuardConfig[],
  moderationConfig: ModerationConfig,
  isAdmin: boolean,
): GuardResult {
  // Admin exemption
  if (moderationConfig.adminExempt && isAdmin) {
    return { blocked: false };
  }

  const contentType = getContentType(msg);
  const textContent = extractTextContent(msg);
  const now = new Date();

  for (const config of guardConfigs) {
    if (!config.enabled) continue;

    const guard = guardRegistry.get(config.guardId);
    if (!guard) continue;

    const ctx: GuardContext = {
      msg,
      chatJid,
      senderJid,
      contentType,
      textContent,
      config,
      isAdmin,
      now,
    };

    const result = guard.evaluate(ctx);
    if (result.blocked) {
      return result;
    }
  }

  return { blocked: false };
}

// Re-export types
export { Guard, GuardResult, GuardContext, GroupGuardConfig, ModerationConfig, DEFAULT_MODERATION_CONFIG } from './types.js';
