import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODERATION_POLICY,
  ModerationEngine,
  listModerationGuards,
  type ModerationMessage,
} from './moderation.js';

const sampleMessage: ModerationMessage = {
  id: 'message-example-1',
  groupId: 'community-alpha@g.us',
  senderId: 'member-example',
  contentType: 'conversation',
  text: 'See https://example.test',
  isForwarded: false,
  isVoiceNote: false,
  timestamp: new Date('2026-01-15T12:00:00Z'),
};

describe('GroupGuard moderation', () => {
  it('publishes the complete set of 14 local guards', () => {
    expect(listModerationGuards().map((guard) => guard.id)).toEqual([
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
    ]);
  });

  it('observes a violation under the safe default policy', () => {
    const result = new ModerationEngine().evaluate(sampleMessage, [{ id: 'no-links', enabled: true }], {
      ...DEFAULT_MODERATION_POLICY,
      adminListVerified: true,
    });

    expect(result).toMatchObject({ action: 'observe', guardId: 'no-links' });
  });

  it('exempts an administrator before evaluating guards', () => {
    const result = new ModerationEngine().evaluate(sampleMessage, [{ id: 'no-links', enabled: true }], {
      ...DEFAULT_MODERATION_POLICY,
      observationMode: false,
      enforcementUnlocked: true,
      adminListVerified: true,
      senderIsAdmin: true,
    });

    expect(result).toEqual({ action: 'allow' });
  });

  it('never deletes while the administrator list is unverified', () => {
    const result = new ModerationEngine().evaluate(sampleMessage, [{ id: 'no-links', enabled: true }], {
      ...DEFAULT_MODERATION_POLICY,
      observationMode: false,
      enforcementUnlocked: true,
      adminListVerified: false,
    });

    expect(result).toMatchObject({ action: 'skip-unverified-admins', guardId: 'no-links' });
  });

  it.each([
    ['text-only', { ...sampleMessage, contentType: 'imageMessage', text: '' }, undefined],
    ['media-only', sampleMessage, undefined],
    ['video-only', { ...sampleMessage, contentType: 'imageMessage', text: '' }, undefined],
    ['voice-only', { ...sampleMessage, contentType: 'audioMessage', text: '', isVoiceNote: false }, undefined],
    ['no-images', { ...sampleMessage, contentType: 'imageMessage', text: '' }, undefined],
    ['no-stickers', { ...sampleMessage, contentType: 'stickerMessage', text: '' }, undefined],
    ['no-links', sampleMessage, undefined],
    ['no-forwarded', { ...sampleMessage, text: '', isForwarded: true }, undefined],
    ['max-text-length', { ...sampleMessage, text: 'too long' }, { maxLength: 3 }],
    ['keyword-filter', { ...sampleMessage, text: 'A blocked phrase appears.' }, { keywords: ['blocked phrase'] }],
    [
      'quiet-hours',
      { ...sampleMessage, text: 'Late message', timestamp: new Date('2026-01-15T12:00:00Z') },
      { startHour: 0, endHour: 23 },
    ],
    ['approved-senders', sampleMessage, { allowedSenderIds: ['another-member'] }],
  ] as const)('evaluates the %s guard', (id, message, params) => {
    const result = new ModerationEngine().evaluate(
      message,
      [{ id, enabled: true, ...(params ? { params } : {}) }],
      { ...DEFAULT_MODERATION_POLICY, adminListVerified: true },
    );

    expect(result).toMatchObject({ action: 'observe', guardId: id });
  });

  it('applies no-spam and slow-mode per sender and group', () => {
    const engine = new ModerationEngine();
    const policy = { ...DEFAULT_MODERATION_POLICY, adminListVerified: true };

    expect(engine.evaluate(sampleMessage, [{ id: 'no-spam', enabled: true, params: { maxMessages: 1 } }], policy)).toEqual({
      action: 'allow',
    });
    expect(
      engine.evaluate(
        { ...sampleMessage, id: 'message-example-2' },
        [{ id: 'no-spam', enabled: true, params: { maxMessages: 1 } }],
        policy,
      ),
    ).toMatchObject({ action: 'observe', guardId: 'no-spam' });

    const slowEngine = new ModerationEngine();
    expect(slowEngine.evaluate(sampleMessage, [{ id: 'slow-mode', enabled: true }], policy)).toEqual({ action: 'allow' });
    expect(
      slowEngine.evaluate({ ...sampleMessage, id: 'message-example-3' }, [{ id: 'slow-mode', enabled: true }], policy),
    ).toMatchObject({ action: 'observe', guardId: 'slow-mode' });
  });
});
