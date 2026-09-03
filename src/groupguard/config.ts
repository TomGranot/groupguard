import { readFile } from 'node:fs/promises';

import { MODERATION_GUARD_IDS, type ModerationGuardConfig } from './moderation/moderation.js';
import type { AccountSafetyOptions } from './reliability/effects.js';

export interface GroupDirectoryConfig {
  taxonomyPath: string;
  source: string;
  cachePath: string;
  model: string;
  ollamaBaseUrl: string;
  minimumConfidence: number;
  refreshHours: number;
  keepAlive: string;
}

export interface GroupModerationConfig {
  guards: ModerationGuardConfig[];
  observationMode: boolean;
  adminExempt: boolean;
  notifyOnDelete: boolean;
  dmCooldownSeconds: number;
  minimumObservationHours: number;
  observationStartedAt: string | null;
}

export interface GroupPolicyConfig {
  directoryEnabled: boolean;
  forwardUnmatchedToAgent: boolean;
  moderation: GroupModerationConfig;
}

export interface GroupGuardConfig {
  schemaVersion: 1;
  directory?: GroupDirectoryConfig;
  groups: Record<string, GroupPolicyConfig>;
  accountSafety: AccountSafetyOptions;
}

const DEFAULT_ACCOUNT_SAFETY: AccountSafetyOptions = {
  budgets: {
    reply: { limit: 8, windowMs: 60_000 },
    'moderation-delete': { limit: 12, windowMs: 60_000 },
    'moderation-dm': { limit: 6, windowMs: 3_600_000 },
  },
  failureThreshold: 3,
  circuitCooldownMs: 15 * 60_000,
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${label} contains unsupported setting: ${unknown.join(', ')}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function bool(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false`);
  return value;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  const result = boundedNumber(value, fallback, minimum, maximum, label);
  if (!Number.isInteger(result)) throw new Error(`${label} must be an integer`);
  return result;
}

function boundedStringList(value: unknown, label: string, maximumItems: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${label} must be an array of at most ${maximumItems} strings`);
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0 || item.length > 256) {
      throw new Error(`${label}[${index}] must be a non-empty string of at most 256 characters`);
    }
    return item.trim();
  });
}

function parseGuardParams(id: ModerationGuardConfig['id'], value: unknown, label: string): Record<string, unknown> {
  const params = value === undefined ? {} : record(value, label);
  const noParams = new Set([
    'text-only',
    'media-only',
    'video-only',
    'voice-only',
    'no-images',
    'no-stickers',
    'no-links',
    'no-forwarded',
  ]);
  if (noParams.has(id)) {
    rejectUnknownKeys(params, [], label);
    return {};
  }
  switch (id) {
    case 'max-text-length':
      rejectUnknownKeys(params, ['maxLength'], label);
      return { maxLength: boundedInteger(params.maxLength, 2_000, 1, 20_000, `${label}.maxLength`) };
    case 'keyword-filter':
      if ('patterns' in params) throw new Error(`${label}: regular expressions are disabled`);
      rejectUnknownKeys(params, ['keywords'], label);
      return { keywords: boundedStringList(params.keywords ?? [], `${label}.keywords`, 100) };
    case 'no-spam':
      rejectUnknownKeys(params, ['maxMessages', 'windowSeconds'], label);
      return {
        maxMessages: boundedInteger(params.maxMessages, 5, 1, 100, `${label}.maxMessages`),
        windowSeconds: boundedInteger(params.windowSeconds, 10, 1, 3_600, `${label}.windowSeconds`),
      };
    case 'slow-mode':
      rejectUnknownKeys(params, ['intervalMinutes'], label);
      return { intervalMinutes: boundedInteger(params.intervalMinutes, 5, 1, 1_440, `${label}.intervalMinutes`) };
    case 'quiet-hours':
      rejectUnknownKeys(params, ['startHour', 'endHour'], label);
      return {
        startHour: boundedInteger(params.startHour, 22, 0, 23, `${label}.startHour`),
        endHour: boundedInteger(params.endHour, 7, 0, 23, `${label}.endHour`),
      };
    case 'approved-senders':
      rejectUnknownKeys(params, ['allowedSenderIds'], label);
      return { allowedSenderIds: boundedStringList(params.allowedSenderIds ?? [], `${label}.allowedSenderIds`, 500) };
  }
  throw new Error(`${label} has an unknown guard ID`);
}

function parseGuard(value: unknown, label: string): ModerationGuardConfig {
  const input = record(value, label);
  rejectUnknownKeys(input, ['id', 'enabled', 'params'], label);
  if (typeof input.id !== 'string' || !MODERATION_GUARD_IDS.includes(input.id as ModerationGuardConfig['id'])) {
    throw new Error(`${label} has an unknown guard ID`);
  }
  if (typeof input.enabled !== 'boolean') throw new Error(`${label}.enabled must be true or false`);
  const id = input.id as ModerationGuardConfig['id'];
  const params = parseGuardParams(id, input.params, `${label}.params`);
  return {
    id,
    enabled: input.enabled,
    ...(Object.keys(params).length > 0 ? { params } : {}),
  };
}

function parseModeration(value: unknown, label: string): GroupModerationConfig {
  const input = value === undefined ? {} : record(value, label);
  rejectUnknownKeys(
    input,
    [
      'guards',
      'observationMode',
      'adminExempt',
      'notifyOnDelete',
      'dmCooldownSeconds',
      'minimumObservationHours',
      'observationStartedAt',
    ],
    label,
  );
  const guardsInput = input.guards ?? [{ id: 'no-spam', enabled: true, params: { maxMessages: 5, windowSeconds: 10 } }];
  if (!Array.isArray(guardsInput) || guardsInput.length > MODERATION_GUARD_IDS.length) {
    throw new Error(`${label}.guards must be an array of at most ${MODERATION_GUARD_IDS.length} guards`);
  }
  const observationStartedAt = input.observationStartedAt;
  const notifyOnDelete = bool(input.notifyOnDelete, false, `${label}.notifyOnDelete`);
  if (notifyOnDelete) {
    throw new Error('Private moderation notifications are disabled; GroupGuard never messages members privately');
  }
  if (observationStartedAt !== undefined && observationStartedAt !== null) {
    const value = text(observationStartedAt, `${label}.observationStartedAt`);
    if (!Number.isFinite(Date.parse(value))) throw new Error(`${label}.observationStartedAt must be an ISO timestamp`);
  }
  return {
    guards: guardsInput.map((guard, index) => parseGuard(guard, `${label}.guards[${index}]`)),
    observationMode: bool(input.observationMode, true, `${label}.observationMode`),
    adminExempt: bool(input.adminExempt, true, `${label}.adminExempt`),
    notifyOnDelete,
    dmCooldownSeconds: boundedNumber(input.dmCooldownSeconds, 300, 60, 86_400, `${label}.dmCooldownSeconds`),
    minimumObservationHours: boundedNumber(
      input.minimumObservationHours,
      24,
      1,
      720,
      `${label}.minimumObservationHours`,
    ),
    observationStartedAt: typeof observationStartedAt === 'string' ? observationStartedAt : null,
  };
}

function parseDirectory(value: unknown): GroupDirectoryConfig {
  const input = record(value, 'directory');
  rejectUnknownKeys(
    input,
    ['taxonomyPath', 'source', 'cachePath', 'model', 'ollamaBaseUrl', 'minimumConfidence', 'refreshHours', 'keepAlive'],
    'directory',
  );
  return {
    taxonomyPath: text(input.taxonomyPath, 'directory.taxonomyPath'),
    source: text(input.source, 'directory.source'),
    cachePath: text(input.cachePath, 'directory.cachePath'),
    model: input.model === undefined ? 'qwen3:4b' : text(input.model, 'directory.model'),
    ollamaBaseUrl:
      input.ollamaBaseUrl === undefined
        ? 'http://127.0.0.1:11434'
        : text(input.ollamaBaseUrl, 'directory.ollamaBaseUrl'),
    minimumConfidence: boundedNumber(input.minimumConfidence, 0.72, 0, 1, 'directory.minimumConfidence'),
    refreshHours: boundedNumber(input.refreshHours, 24, 1, 168, 'directory.refreshHours'),
    keepAlive: input.keepAlive === undefined ? '25h' : text(input.keepAlive, 'directory.keepAlive'),
  };
}

export function parseGroupGuardConfig(value: unknown): GroupGuardConfig {
  const input = record(value, 'GroupGuard config');
  rejectUnknownKeys(input, ['schemaVersion', 'directory', 'groups'], 'GroupGuard config');
  if (input.schemaVersion !== 1) throw new Error('GroupGuard config schemaVersion must be 1');
  const groupsInput = record(input.groups, 'groups');
  const groups: Record<string, GroupPolicyConfig> = {};
  for (const [groupId, candidate] of Object.entries(groupsInput)) {
    if (!groupId.endsWith('@g.us')) throw new Error(`Only WhatsApp group IDs are allowed: ${groupId}`);
    const group = record(candidate, `groups.${groupId}`);
    rejectUnknownKeys(group, ['directoryEnabled', 'forwardUnmatchedToAgent', 'moderation'], `groups.${groupId}`);
    groups[groupId] = {
      directoryEnabled: bool(group.directoryEnabled, false, `groups.${groupId}.directoryEnabled`),
      forwardUnmatchedToAgent: bool(group.forwardUnmatchedToAgent, false, `groups.${groupId}.forwardUnmatchedToAgent`),
      moderation: parseModeration(group.moderation, `groups.${groupId}.moderation`),
    };
  }
  const directory = input.directory === undefined ? undefined : parseDirectory(input.directory);
  if (!directory && Object.values(groups).some((group) => group.directoryEnabled)) {
    throw new Error('A directory configuration is required when a group enables directory responses');
  }
  return { schemaVersion: 1, ...(directory ? { directory } : {}), groups, accountSafety: DEFAULT_ACCOUNT_SAFETY };
}

export async function loadGroupGuardConfig(configPath: string): Promise<GroupGuardConfig> {
  return parseGroupGuardConfig(JSON.parse(await readFile(configPath, 'utf8')) as unknown);
}
