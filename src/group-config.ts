import { z } from 'zod';

import { ALLOW_REGEX_FILTERS } from './config.js';
import { RegisteredGroup } from './types.js';

export const moderationConfigSchema = z.object({
  observationMode: z.boolean().default(true),
  adminExempt: z.boolean().default(true),
  dmCooldownSeconds: z.number().int().min(60).max(86_400).default(300),
  notifyOnDelete: z.boolean().default(false),
});

const GUARD_IDS = [
  'text-only', 'media-only', 'video-only', 'voice-only', 'no-images', 'no-stickers',
  'no-links', 'no-forwarded', 'max-text-length', 'keyword-filter',
  'no-spam', 'slow-mode', 'quiet-hours', 'approved-senders',
] as const;

const PARAM_KEYS: Record<(typeof GUARD_IDS)[number], string[]> = {
  'text-only': [],
  'media-only': [],
  'video-only': [],
  'voice-only': [],
  'no-images': [],
  'no-stickers': [],
  'no-links': [],
  'no-forwarded': [],
  'max-text-length': ['maxLength'],
  'keyword-filter': ['keywords', 'patterns'],
  'no-spam': ['maxMessages', 'windowSeconds'],
  'slow-mode': ['intervalMinutes'],
  'quiet-hours': ['startHour', 'endHour'],
  'approved-senders': ['allowedJids'],
};

function validateInteger(
  params: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  context: z.RefinementCtx,
): void {
  const value = params[key];
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    context.addIssue({
      code: 'custom',
      path: ['params', key],
      message: `${key} must be an integer from ${minimum} to ${maximum}`,
    });
  }
}

export const guardConfigSchema = z.object({
  guardId: z.enum(GUARD_IDS),
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()).optional(),
}).superRefine((guard, context) => {
  const params = guard.params || {};
  const allowedKeys = PARAM_KEYS[guard.guardId];
  for (const key of Object.keys(params)) {
    if (!allowedKeys.includes(key)) {
      context.addIssue({
        code: 'custom',
        path: ['params', key],
        message: `${key} is not valid for ${guard.guardId}`,
      });
    }
  }

  if (guard.guardId === 'no-spam') {
    validateInteger(params, 'maxMessages', 1, 100, context);
    validateInteger(params, 'windowSeconds', 1, 3_600, context);
  } else if (guard.guardId === 'slow-mode') {
    validateInteger(params, 'intervalMinutes', 1, 1_440, context);
  } else if (guard.guardId === 'quiet-hours') {
    validateInteger(params, 'startHour', 0, 23, context);
    validateInteger(params, 'endHour', 0, 23, context);
  } else if (guard.guardId === 'max-text-length') {
    validateInteger(params, 'maxLength', 1, 65_536, context);
  } else if (guard.guardId === 'approved-senders') {
    const allowedJids = params.allowedJids;
    if (allowedJids !== undefined && (
      !Array.isArray(allowedJids) ||
      allowedJids.length > 500 ||
      allowedJids.some((value) => typeof value !== 'string' || value.length > 128)
    )) {
      context.addIssue({ code: 'custom', path: ['params', 'allowedJids'], message: 'allowedJids must be an array of at most 500 JIDs' });
    }
  } else if (guard.guardId === 'keyword-filter') {
    const keywords = params.keywords;
    if (keywords !== undefined && (
      !Array.isArray(keywords) ||
      keywords.length > 500 ||
      keywords.some((value) => typeof value !== 'string' || value.length > 128)
    )) {
      context.addIssue({ code: 'custom', path: ['params', 'keywords'], message: 'keywords must contain at most 500 entries of 128 characters' });
    }

    const patterns = params.patterns;
    if (patterns !== undefined) {
      if (!Array.isArray(patterns)) {
        context.addIssue({ code: 'custom', path: ['params', 'patterns'], message: 'patterns must be an array' });
      } else if (patterns.length > 0 && !ALLOW_REGEX_FILTERS) {
        context.addIssue({
          code: 'custom',
          path: ['params', 'patterns'],
          message: 'regex patterns require GROUPGUARD_ALLOW_REGEX_FILTERS=true outside WhatsApp',
        });
      } else if (
        patterns.length > 100 ||
        patterns.some((value) => typeof value !== 'string' || value.length > 128)
      ) {
        context.addIssue({ code: 'custom', path: ['params', 'patterns'], message: 'patterns must contain at most 100 entries of 128 characters' });
      }
    }
  }
});

export const registeredGroupSchema = z.object({
  name: z.string().min(1).max(128),
  folder: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  trigger: z.string().min(1).max(64).default('@GroupGuard'),
  added_at: z.string(),
  containerConfig: z.object({
    additionalMounts: z.array(z.object({
      hostPath: z.string().min(1),
      containerPath: z.string().min(1),
      readonly: z.boolean().optional(),
    })).optional(),
    timeout: z.number().int().min(1_000).max(30 * 60 * 1000).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }).optional(),
  playground: z.object({
    enabled: z.boolean(),
    setupUrl: z.string().url().max(2_048).refine(
      (value) => value.startsWith('https://'),
      'setupUrl must use HTTPS',
    ),
    cooldownSeconds: z.number().int().min(30).max(3_600),
    maxResponsesPerMinute: z.number().int().min(1).max(20),
  }).optional(),
  guards: z.array(guardConfigSchema).default([]),
  moderationConfig: moderationConfigSchema.default({
    observationMode: true,
    adminExempt: true,
    dmCooldownSeconds: 300,
    notifyOnDelete: false,
  }),
});

export const SAFE_MODERATION_DEFAULTS = moderationConfigSchema.parse({});

export const SAFE_STARTER_GUARDS: NonNullable<RegisteredGroup['guards']> = [
  {
    guardId: 'no-spam',
    enabled: true,
    params: { maxMessages: 5, windowSeconds: 10 },
  },
];

export function parseRegisteredGroups(value: unknown): {
  groups: Record<string, RegisteredGroup>;
  errors: string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { groups: {}, errors: ['registered_groups.json must contain an object keyed by WhatsApp JID'] };
  }

  const groups: Record<string, RegisteredGroup> = {};
  const errors: string[] = [];
  const folderOwners = new Map<string, string>();

  for (const [jid, candidate] of Object.entries(value)) {
    if (!jid.endsWith('@g.us')) {
      errors.push(`${jid}: only WhatsApp group JIDs ending in @g.us are accepted`);
      continue;
    }

    const parsed = registeredGroupSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push(`${jid}: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
      continue;
    }
    const existingOwner = folderOwners.get(parsed.data.folder);
    if (existingOwner) {
      errors.push(`${jid}: folder ${parsed.data.folder} is already used by ${existingOwner}`);
      continue;
    }
    folderOwners.set(parsed.data.folder, jid);
    groups[jid] = parsed.data;
  }

  return { groups, errors };
}

export function createSafeGroup(name: string, folder: string): RegisteredGroup {
  return registeredGroupSchema.parse({
    name,
    folder,
    trigger: '@GroupGuard',
    added_at: new Date().toISOString(),
    guards: SAFE_STARTER_GUARDS,
    moderationConfig: SAFE_MODERATION_DEFAULTS,
  });
}
