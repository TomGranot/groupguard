export type WhatsAppIngressReason = 'allowed-group' | 'private-chat' | 'group-not-allowed';

export interface WhatsAppIngressDecision {
  accepted: boolean;
  reason: WhatsAppIngressReason;
}

/**
 * Parse the operator-owned allowlist. Only WhatsApp group identifiers are
 * retained, so a mistaken private-chat identifier can never become eligible.
 */
export function parseAllowedWhatsAppGroups(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.endsWith('@g.us')),
  );
}

/**
 * The privacy boundary for the GroupGuard WhatsApp profile. This decision is
 * made before metadata callbacks, media downloads, persistence, or inference.
 */
export function decideWhatsAppIngress(
  platformId: string,
  allowedGroups: ReadonlySet<string>,
): WhatsAppIngressDecision {
  if (!platformId.endsWith('@g.us')) {
    return { accepted: false, reason: 'private-chat' };
  }
  if (!allowedGroups.has(platformId)) {
    return { accepted: false, reason: 'group-not-allowed' };
  }
  return { accepted: true, reason: 'allowed-group' };
}
