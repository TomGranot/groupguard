import { Guard, GuardContext, GuardResult } from './types.js';

const pass: GuardResult = { blocked: false };

function block(guardId: string, reason: string): GuardResult {
  return { blocked: true, guardId, reason };
}

/**
 * In-memory rate limiting state.
 * Key: `${chatJid}:${senderJid}`, Value: array of timestamps (ms).
 */
const messageTimes = new Map<string, number[]>();

// Clean up old entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, times] of messageTimes) {
    const filtered = times.filter((t) => t > cutoff);
    if (filtered.length === 0) {
      messageTimes.delete(key);
    } else {
      messageTimes.set(key, filtered);
    }
  }
}, 10 * 60 * 1000);

function getKey(chatJid: string, senderJid: string): string {
  return `${chatJid}:${senderJid}`;
}

function recordMessage(chatJid: string, senderJid: string, now: number): void {
  const key = getKey(chatJid, senderJid);
  const times = messageTimes.get(key) || [];
  times.push(now);
  messageTimes.set(key, times);
}

function getRecentCount(chatJid: string, senderJid: string, windowMs: number, now: number): number {
  const key = getKey(chatJid, senderJid);
  const times = messageTimes.get(key) || [];
  const cutoff = now - windowMs;
  return times.filter((t) => t > cutoff).length;
}

export const quietHoursGuard: Guard = {
  id: 'quiet-hours',
  name: 'Quiet Hours',
  description: 'Block messages during specified hours. Set params.startHour and params.endHour (0-23, default: 22-07).',
  evaluate: (ctx: GuardContext): GuardResult => {
    const startHour = (ctx.config.params?.startHour as number) ?? 22;
    const endHour = (ctx.config.params?.endHour as number) ?? 7;
    const hour = ctx.now.getHours();

    let isQuiet: boolean;
    if (startHour < endHour) {
      isQuiet = hour >= startHour && hour < endHour;
    } else {
      isQuiet = hour >= startHour || hour < endHour;
    }

    if (isQuiet) {
      return block('quiet-hours', `This group is in quiet hours (${startHour}:00 - ${endHour}:00). Please try again later.`);
    }
    return pass;
  },
};

export const slowModeGuard: Guard = {
  id: 'slow-mode',
  name: 'Slow Mode',
  description: 'Limit users to 1 message per N minutes. Set params.intervalMinutes (default: 5).',
  evaluate: (ctx: GuardContext): GuardResult => {
    const intervalMinutes = (ctx.config.params?.intervalMinutes as number) || 5;
    const windowMs = intervalMinutes * 60 * 1000;
    const now = ctx.now.getTime();

    const recentCount = getRecentCount(ctx.chatJid, ctx.senderJid, windowMs, now);
    recordMessage(ctx.chatJid, ctx.senderJid, now);

    if (recentCount >= 1) {
      return block('slow-mode', `Slow mode is active. You can send 1 message every ${intervalMinutes} minutes.`);
    }
    return pass;
  },
};

export const noSpamGuard: Guard = {
  id: 'no-spam',
  name: 'No Spam (Rate Limit)',
  description: 'Block rapid-fire messages. Set params.maxMessages (default: 5) and params.windowSeconds (default: 10).',
  evaluate: (ctx: GuardContext): GuardResult => {
    const maxMessages = (ctx.config.params?.maxMessages as number) || 5;
    const windowSeconds = (ctx.config.params?.windowSeconds as number) || 10;
    const windowMs = windowSeconds * 1000;
    const now = ctx.now.getTime();

    const recentCount = getRecentCount(ctx.chatJid, ctx.senderJid, windowMs, now);
    recordMessage(ctx.chatJid, ctx.senderJid, now);

    if (recentCount >= maxMessages) {
      return block('no-spam', `You're sending messages too quickly. Max ${maxMessages} messages per ${windowSeconds} seconds.`);
    }
    return pass;
  },
};

export const approvedSendersGuard: Guard = {
  id: 'approved-senders',
  name: 'Approved Senders Only',
  description: 'Only whitelisted senders can post. Set params.allowedJids as string array.',
  evaluate: (ctx: GuardContext): GuardResult => {
    const allowedJids = (ctx.config.params?.allowedJids as string[]) || [];
    if (allowedJids.length === 0) return pass;
    if (!allowedJids.includes(ctx.senderJid)) {
      return block('approved-senders', 'You are not on the approved senders list for this group.');
    }
    return pass;
  },
};

export const behavioralGuards: Guard[] = [
  quietHoursGuard,
  slowModeGuard,
  noSpamGuard,
  approvedSendersGuard,
];
