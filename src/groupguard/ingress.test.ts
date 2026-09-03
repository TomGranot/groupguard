import { describe, expect, it } from 'vitest';

import { decideWhatsAppIngress, parseAllowedWhatsAppGroups } from './ingress.js';

describe('GroupGuard WhatsApp ingress', () => {
  it('rejects private chats before any downstream work', () => {
    const allowed = parseAllowedWhatsAppGroups('community-alpha@g.us');

    expect(decideWhatsAppIngress('sample-user@s.whatsapp.net', allowed)).toEqual({
      accepted: false,
      reason: 'private-chat',
    });
  });

  it('rejects groups that the operator did not allow', () => {
    const allowed = parseAllowedWhatsAppGroups('community-alpha@g.us');

    expect(decideWhatsAppIngress('community-beta@g.us', allowed)).toEqual({
      accepted: false,
      reason: 'group-not-allowed',
    });
  });

  it('accepts an explicitly allowed group', () => {
    const allowed = parseAllowedWhatsAppGroups(' community-alpha@g.us , invalid-dm@s.whatsapp.net ');

    expect(decideWhatsAppIngress('community-alpha@g.us', allowed)).toEqual({
      accepted: true,
      reason: 'allowed-group',
    });
  });

  it('fails closed when the allowlist is empty', () => {
    expect(decideWhatsAppIngress('community-alpha@g.us', parseAllowedWhatsAppGroups(''))).toEqual({
      accepted: false,
      reason: 'group-not-allowed',
    });
  });
});
