export const MODERATION_GUARD_IDS = [
  'text-only',
  'media-only',
  'video-only',
  'voice-only',
  'no-images',
  'no-stickers',
  'no-links',
  'no-forwarded',
  'max-text-length',
  'keyword-filter',
  'no-spam',
  'slow-mode',
  'quiet-hours',
  'approved-senders',
] as const;

export type ModerationGuardId = (typeof MODERATION_GUARD_IDS)[number];

export interface ModerationGuardConfig {
  id: ModerationGuardId;
  enabled: boolean;
  params?: Record<string, unknown>;
}

export interface ModerationMessage {
  id: string;
  groupId: string;
  senderId: string;
  contentType: string;
  text: string;
  isForwarded: boolean;
  isVoiceNote: boolean;
  timestamp: Date;
}

export interface ModerationPolicy {
  observationMode: boolean;
  enforcementUnlocked: boolean;
  adminExempt: boolean;
  adminListVerified: boolean;
  senderIsAdmin: boolean;
  notifyOnDelete: boolean;
}

export const DEFAULT_MODERATION_POLICY: ModerationPolicy = {
  observationMode: true,
  enforcementUnlocked: false,
  adminExempt: true,
  adminListVerified: false,
  senderIsAdmin: false,
  notifyOnDelete: false,
};

export type ModerationAction = 'allow' | 'observe' | 'delete' | 'skip-unverified-admins';

export interface ModerationDecision {
  action: ModerationAction;
  guardId?: ModerationGuardId;
  reason?: string;
}

const GUARD_DESCRIPTIONS: Record<ModerationGuardId, { name: string; description: string }> = {
  'text-only': { name: 'Text only', description: 'Allow text messages only.' },
  'media-only': { name: 'Media only', description: 'Allow media messages only.' },
  'video-only': { name: 'Video only', description: 'Allow video messages only.' },
  'voice-only': { name: 'Voice only', description: 'Allow voice notes only.' },
  'no-images': { name: 'No images', description: 'Block image messages.' },
  'no-stickers': { name: 'No stickers', description: 'Block sticker messages.' },
  'no-links': { name: 'No links', description: 'Block messages containing links.' },
  'no-forwarded': { name: 'No forwarded messages', description: 'Block forwarded messages.' },
  'max-text-length': { name: 'Maximum text length', description: 'Limit message length.' },
  'keyword-filter': { name: 'Keyword filter', description: 'Block configured words or patterns.' },
  'no-spam': { name: 'No spam', description: 'Limit rapid messages.' },
  'slow-mode': { name: 'Slow mode', description: 'Require a delay between messages.' },
  'quiet-hours': { name: 'Quiet hours', description: 'Restrict messages during configured hours.' },
  'approved-senders': { name: 'Approved senders', description: 'Allow configured senders only.' },
};

export function listModerationGuards(): Array<{ id: ModerationGuardId; name: string; description: string }> {
  return MODERATION_GUARD_IDS.map((id) => ({ id, ...GUARD_DESCRIPTIONS[id] }));
}

const MEDIA_TYPES = new Set([
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'documentWithCaptionMessage',
  'stickerMessage',
]);

function numberParam(config: ModerationGuardConfig, key: string, fallback: number): number {
  const value = config.params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringListParam(config: ModerationGuardConfig, key: string): string[] {
  const value = config.params?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsKeyword(text: string, keyword: string): boolean {
  if (!keyword) return false;
  const expression = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegex(keyword)}(?=$|[^\\p{L}\\p{N}_])`,
    'iu',
  );
  return expression.test(text);
}

function isQuietHour(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export class ModerationEngine {
  private readonly messageTimes = new Map<string, number[]>();

  private recentCount(key: string, timestamp: number, windowMs: number): number {
    const cutoff = timestamp - windowMs;
    const recent = (this.messageTimes.get(key) ?? []).filter((value) => value > cutoff);
    this.messageTimes.set(key, recent);
    return recent.length;
  }

  private record(key: string, timestamp: number): void {
    this.messageTimes.set(key, [...(this.messageTimes.get(key) ?? []), timestamp]);
  }

  private evaluateGuard(message: ModerationMessage, config: ModerationGuardConfig): string | undefined {
    switch (config.id) {
      case 'text-only':
        return message.contentType === 'conversation' || message.contentType === 'extendedTextMessage'
          ? undefined
          : 'Only text messages are allowed in this group.';
      case 'media-only':
        return MEDIA_TYPES.has(message.contentType) ? undefined : 'Only media messages are allowed in this group.';
      case 'video-only':
        return message.contentType === 'videoMessage' ? undefined : 'Only video messages are allowed in this group.';
      case 'voice-only':
        return message.contentType === 'audioMessage' && message.isVoiceNote
          ? undefined
          : 'Only voice notes are allowed in this group.';
      case 'no-images':
        return message.contentType === 'imageMessage' ? 'Images are not allowed in this group.' : undefined;
      case 'no-stickers':
        return message.contentType === 'stickerMessage' ? 'Stickers are not allowed in this group.' : undefined;
      case 'no-links':
        return /https?:\/\/\S+|www\.\S+|\S+\.(?:com|org|net|io|co|me|info)\b/iu.test(message.text)
          ? 'Links are not allowed in this group.'
          : undefined;
      case 'no-forwarded':
        return message.isForwarded ? 'Forwarded messages are not allowed in this group.' : undefined;
      case 'max-text-length': {
        const maximum = numberParam(config, 'maxLength', 2_000);
        return message.text.length > maximum ? `Messages over ${maximum} characters are not allowed.` : undefined;
      }
      case 'keyword-filter': {
        const keywordMatched = stringListParam(config, 'keywords').some((keyword) => containsKeyword(message.text, keyword));
        const patternMatched = stringListParam(config, 'patterns').some((pattern) => {
          try {
            return new RegExp(pattern, 'iu').test(message.text);
          } catch {
            return false;
          }
        });
        return keywordMatched || patternMatched ? 'This message was blocked by a content filter.' : undefined;
      }
      case 'no-spam': {
        const maximum = numberParam(config, 'maxMessages', 5);
        const windowMs = numberParam(config, 'windowSeconds', 10) * 1_000;
        const timestamp = message.timestamp.getTime();
        const key = `no-spam:${message.groupId}:${message.senderId}`;
        const count = this.recentCount(key, timestamp, windowMs);
        this.record(key, timestamp);
        return count >= maximum
          ? `You are sending messages too quickly. Maximum ${maximum} messages per ${windowMs / 1_000} seconds.`
          : undefined;
      }
      case 'slow-mode': {
        const intervalMinutes = numberParam(config, 'intervalMinutes', 5);
        const timestamp = message.timestamp.getTime();
        const key = `slow-mode:${message.groupId}:${message.senderId}`;
        const count = this.recentCount(key, timestamp, intervalMinutes * 60_000);
        this.record(key, timestamp);
        return count >= 1 ? `Slow mode allows one message every ${intervalMinutes} minutes.` : undefined;
      }
      case 'quiet-hours': {
        const startHour = numberParam(config, 'startHour', 22);
        const endHour = numberParam(config, 'endHour', 7);
        return isQuietHour(message.timestamp.getHours(), startHour, endHour)
          ? `This group is in quiet hours (${startHour}:00 to ${endHour}:00).`
          : undefined;
      }
      case 'approved-senders': {
        const allowed = stringListParam(config, 'allowedSenderIds');
        return allowed.length > 0 && !allowed.includes(message.senderId)
          ? 'This sender is not on the approved list for this group.'
          : undefined;
      }
    }
  }

  evaluate(
    message: ModerationMessage,
    guards: readonly ModerationGuardConfig[],
    policy: ModerationPolicy,
  ): ModerationDecision {
    if (policy.adminExempt && policy.senderIsAdmin) return { action: 'allow' };

    for (const guard of guards) {
      if (!guard.enabled) continue;
      const reason = this.evaluateGuard(message, guard);
      if (!reason) continue;

      if (policy.observationMode || !policy.enforcementUnlocked) {
        return { action: 'observe', guardId: guard.id, reason };
      }
      if (policy.adminExempt && !policy.adminListVerified) {
        return { action: 'skip-unverified-admins', guardId: guard.id, reason };
      }
      return { action: 'delete', guardId: guard.id, reason };
    }

    return { action: 'allow' };
  }
}
