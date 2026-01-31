import { Guard, GuardContext, GuardResult } from './types.js';

const MEDIA_TYPES = new Set([
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'documentWithCaptionMessage',
  'stickerMessage',
]);

const pass: GuardResult = { blocked: false };

function block(guardId: string, reason: string): GuardResult {
  return { blocked: true, guardId, reason };
}

export const textOnlyGuard: Guard = {
  id: 'text-only',
  name: 'Text Only',
  description: 'Only text messages allowed — blocks media, stickers, documents, etc.',
  evaluate: (ctx: GuardContext): GuardResult => {
    const ct = ctx.contentType;
    if (!ct) return pass;
    if (ct === 'conversation' || ct === 'extendedTextMessage') return pass;
    return block('text-only', 'Only text messages are allowed in this group.');
  },
};

export const videoOnlyGuard: Guard = {
  id: 'video-only',
  name: 'Video Only',
  description: 'Only video messages allowed.',
  evaluate: (ctx: GuardContext): GuardResult => {
    const ct = ctx.contentType;
    if (!ct) return pass;
    if (ct === 'videoMessage') return pass;
    return block('video-only', 'Only video messages are allowed in this group.');
  },
};

export const voiceOnlyGuard: Guard = {
  id: 'voice-only',
  name: 'Voice Only',
  description: 'Only voice notes allowed.',
  evaluate: (ctx: GuardContext): GuardResult => {
    const ct = ctx.contentType;
    if (!ct) return pass;
    if (ct === 'audioMessage' && ctx.msg.message?.audioMessage?.ptt) return pass;
    return block('voice-only', 'Only voice notes are allowed in this group.');
  },
};

export const mediaOnlyGuard: Guard = {
  id: 'media-only',
  name: 'Media Only',
  description: 'Only media messages (images, videos, audio, documents) allowed — blocks text.',
  evaluate: (ctx: GuardContext): GuardResult => {
    const ct = ctx.contentType;
    if (!ct) return pass;
    if (MEDIA_TYPES.has(ct)) return pass;
    return block('media-only', 'Only media messages are allowed in this group.');
  },
};

export const noStickersGuard: Guard = {
  id: 'no-stickers',
  name: 'No Stickers',
  description: 'Block sticker messages.',
  evaluate: (ctx: GuardContext): GuardResult => {
    if (ctx.contentType === 'stickerMessage') {
      return block('no-stickers', 'Stickers are not allowed in this group.');
    }
    return pass;
  },
};

export const noImagesGuard: Guard = {
  id: 'no-images',
  name: 'No Images',
  description: 'Block image messages.',
  evaluate: (ctx: GuardContext): GuardResult => {
    if (ctx.contentType === 'imageMessage') {
      return block('no-images', 'Images are not allowed in this group.');
    }
    return pass;
  },
};

export const contentGuards: Guard[] = [
  textOnlyGuard,
  videoOnlyGuard,
  voiceOnlyGuard,
  mediaOnlyGuard,
  noStickersGuard,
  noImagesGuard,
];
