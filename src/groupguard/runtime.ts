import type { GroupGuardConfig } from './config.js';
import type { DirectoryResponder } from './directory/responder.js';
import { DEFAULT_MODERATION_POLICY, ModerationEngine, type ModerationAction } from './moderation/moderation.js';
import { AccountSafetyController, EffectLedger } from './reliability/effects.js';

export interface GroupGuardEvent {
  id: string;
  groupId: string;
  senderId: string;
  text: string;
  contentType: string;
  isForwarded: boolean;
  isVoiceNote: boolean;
  timestamp: Date;
}

export interface GroupGuardRuntimeResult {
  handled: boolean;
  duplicate?: boolean;
  directoryReplied?: boolean;
  moderationAction?: ModerationAction;
}

export interface GroupGuardRuntimeOptions {
  config: GroupGuardConfig;
  ledger: EffectLedger;
  safety: AccountSafetyController;
  directoryResponder: () => DirectoryResponder | undefined;
  sendMessage: (groupId: string, text: string) => Promise<string | undefined>;
  deleteMessage: (event: GroupGuardEvent) => Promise<void>;
  resolveAdminState: (event: GroupGuardEvent) => Promise<{ verified: boolean; senderIsAdmin: boolean }>;
  enforcementEnabled: boolean;
  now?: () => Date;
}

function observationComplete(
  startedAt: string | null,
  minimumHours: number,
  now: Date,
): boolean {
  if (!startedAt) return false;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return false;
  return now.getTime() - started >= minimumHours * 60 * 60_000;
}

export class GroupGuardRuntime {
  private readonly moderation = new ModerationEngine();
  private readonly now: () => Date;

  constructor(private readonly options: GroupGuardRuntimeOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async handle(event: GroupGuardEvent): Promise<GroupGuardRuntimeResult> {
    const group = this.options.config.groups[event.groupId];
    if (!group) return { handled: true };
    let observedAction: ModerationAction | undefined;

    if (group.moderation.guards.some((guard) => guard.enabled)) {
      let adminState = { verified: false, senderIsAdmin: false };
      if (group.moderation.adminExempt) {
        try {
          adminState = await this.options.resolveAdminState(event);
        } catch {
          adminState = { verified: false, senderIsAdmin: false };
        }
      }
      const canEnforce =
        this.options.enforcementEnabled &&
        !group.moderation.observationMode &&
        observationComplete(
          group.moderation.observationStartedAt,
          group.moderation.minimumObservationHours,
          this.now(),
        );
      const decision = this.moderation.evaluate(event, group.moderation.guards, {
        ...DEFAULT_MODERATION_POLICY,
        observationMode: !canEnforce,
        enforcementUnlocked: canEnforce,
        adminExempt: group.moderation.adminExempt,
        adminListVerified: adminState.verified,
        senderIsAdmin: adminState.senderIsAdmin,
        notifyOnDelete: group.moderation.notifyOnDelete,
      });

      if (decision.action !== 'allow') {
        const effectKey = `moderation:${event.groupId}:${event.id}`;
        const claim = this.options.ledger.claim({
          effectKey,
          groupId: event.groupId,
          inboundId: event.id,
          kind: decision.action === 'delete' ? 'moderation-delete' : 'moderation-observation',
          payload: JSON.stringify({ action: decision.action, guardId: decision.guardId, reason: decision.reason }),
        });

        if (decision.action === 'delete') {
          if (!claim.claimed) return { handled: true, duplicate: true, moderationAction: 'delete' };
          const permit = this.options.safety.reserve('moderation-delete');
          if (!permit.allowed) {
            this.options.ledger.markSkipped(effectKey, permit.reason ?? 'account-safety');
            return { handled: true, moderationAction: 'delete' };
          }
          try {
            await this.options.deleteMessage(event);
            this.options.safety.recordSuccess();
            this.options.ledger.markDelivered(effectKey);
          } catch {
            this.options.safety.recordFailure();
            this.options.ledger.markUnknown(effectKey, 'WhatsApp deletion result is unknown');
          }
          return { handled: true, moderationAction: 'delete' };
        }

        if (claim.claimed) this.options.ledger.markDelivered(effectKey);
        if (decision.action === 'skip-unverified-admins') {
          return { handled: true, moderationAction: decision.action };
        }
        observedAction = decision.action;
      }
    }

    if (group.directoryEnabled) {
      const responder = this.options.directoryResponder();
      const response = responder ? await responder.respond({ messageId: event.id, text: event.text }) : null;
      if (response) {
        const effectKey = `directory:${event.groupId}:${event.id}`;
        const claim = this.options.ledger.claim({
          effectKey,
          groupId: event.groupId,
          inboundId: event.id,
          kind: 'directory-reply',
          payload: response.text,
        });
        if (!claim.claimed) return { handled: true, duplicate: true };
        const permit = this.options.safety.reserve('reply');
        if (!permit.allowed) {
          this.options.ledger.markSkipped(effectKey, permit.reason ?? 'account-safety');
          return { handled: true };
        }
        try {
          const platformMessageId = await this.options.sendMessage(event.groupId, claim.record.payload);
          this.options.safety.recordSuccess();
          this.options.ledger.markDelivered(effectKey, platformMessageId);
          return { handled: true, directoryReplied: true, ...(observedAction ? { moderationAction: observedAction } : {}) };
        } catch {
          this.options.safety.recordFailure();
          this.options.ledger.markUnknown(effectKey, 'WhatsApp reply result is unknown');
          return { handled: true };
        }
      }
    }

    return {
      handled: !group.forwardUnmatchedToAgent,
      ...(observedAction ? { moderationAction: observedAction } : {}),
    };
  }
}
