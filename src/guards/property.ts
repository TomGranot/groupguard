import { Guard, GuardContext, GuardResult } from './types.js';

const pass: GuardResult = { blocked: false };

function block(guardId: string, reason: string): GuardResult {
  return { blocked: true, guardId, reason };
}

const URL_PATTERN = /https?:\/\/\S+|www\.\S+|\S+\.(com|org|net|io|co|me|info|xyz)\b/i;

export const noLinksGuard: Guard = {
  id: 'no-links',
  name: 'No Links',
  description: 'Block messages containing URLs.',
  evaluate: (ctx: GuardContext): GuardResult => {
    if (ctx.textContent && URL_PATTERN.test(ctx.textContent)) {
      return block('no-links', 'Links are not allowed in this group.');
    }
    const matchedText = ctx.msg.message?.extendedTextMessage?.matchedText;
    if (matchedText) {
      return block('no-links', 'Links are not allowed in this group.');
    }
    return pass;
  },
};

export const noForwardedGuard: Guard = {
  id: 'no-forwarded',
  name: 'No Forwarded Messages',
  description: 'Block forwarded messages.',
  evaluate: (ctx: GuardContext): GuardResult => {
    const msg = ctx.msg.message;
    if (!msg) return pass;

    const contextInfo =
      msg.extendedTextMessage?.contextInfo ||
      msg.imageMessage?.contextInfo ||
      msg.videoMessage?.contextInfo ||
      msg.audioMessage?.contextInfo ||
      msg.documentMessage?.contextInfo ||
      msg.stickerMessage?.contextInfo;

    if (contextInfo?.isForwarded) {
      return block('no-forwarded', 'Forwarded messages are not allowed in this group.');
    }
    return pass;
  },
};

export const maxTextLengthGuard: Guard = {
  id: 'max-text-length',
  name: 'Max Text Length',
  description: 'Block text messages exceeding a character limit. Set params.maxLength (default: 2000).',
  evaluate: (ctx: GuardContext): GuardResult => {
    if (!ctx.textContent) return pass;
    const maxLength = (ctx.config.params?.maxLength as number) || 2000;
    if (ctx.textContent.length > maxLength) {
      return block('max-text-length', `Messages over ${maxLength} characters are not allowed.`);
    }
    return pass;
  },
};

export const propertyGuards: Guard[] = [
  noLinksGuard,
  noForwardedGuard,
  maxTextLengthGuard,
];
