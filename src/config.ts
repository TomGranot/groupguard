import fs from 'fs';
import path from 'path';

/**
 * Load local runtime settings without adding another dependency. Existing
 * environment variables win so service managers and containers can override
 * the file safely.
 */
function loadLocalEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function booleanSetting(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
  throw new Error(`${name} must be true or false`);
}

function integerSetting(
  name: string,
  fallback: number,
  minimum = 1,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

loadLocalEnv();

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'GroupGuard';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Safe product defaults. Moderation works without Docker or an AI provider.
export const AGENT_ENABLED = booleanSetting('GROUPGUARD_AGENT_ENABLED', false);
export const ENFORCEMENT_ENABLED = booleanSetting('GROUPGUARD_ENFORCEMENT_ENABLED', false);
export const AGENT_PROJECT_WRITE_ENABLED = booleanSetting('GROUPGUARD_AGENT_PROJECT_WRITE_ENABLED', false);
export const MIN_OBSERVATION_HOURS = integerSetting('GROUPGUARD_MIN_OBSERVATION_HOURS', 24, 1, 720);
export const ALLOW_REGEX_FILTERS = booleanSetting('GROUPGUARD_ALLOW_REGEX_FILTERS', false);
export const TYPING_INDICATOR_ENABLED = booleanSetting('GROUPGUARD_TYPING_INDICATOR_ENABLED', false);
export const PUBLIC_PLAYGROUND_ENABLED = booleanSetting('GROUPGUARD_PUBLIC_PLAYGROUND_ENABLED', false);

// Account-level action budgets. These are conservative product limits, not
// published WhatsApp limits. Operators may lower them, but should raise them
// only after a stable observation period.
export const MAX_OUTBOUND_MESSAGES_PER_MINUTE = integerSetting(
  'GROUPGUARD_MAX_OUTBOUND_MESSAGES_PER_MINUTE',
  8,
  1,
  100,
);
export const MAX_MODERATION_ACTIONS_PER_MINUTE = integerSetting(
  'GROUPGUARD_MAX_MODERATION_ACTIONS_PER_MINUTE',
  12,
  1,
  120,
);
export const MAX_MODERATION_DMS_PER_HOUR = integerSetting(
  'GROUPGUARD_MAX_MODERATION_DMS_PER_HOUR',
  6,
  1,
  100,
);
export const SAFETY_FAILURE_THRESHOLD = integerSetting('GROUPGUARD_SAFETY_FAILURE_THRESHOLD', 3, 1, 10);
export const SAFETY_CIRCUIT_COOLDOWN_MS = integerSetting(
  'GROUPGUARD_SAFETY_CIRCUIT_COOLDOWN_MS',
  15 * 60 * 1000,
  60_000,
  24 * 60 * 60 * 1000,
);
export const WHATSAPP_ACTION_TIMEOUT_MS = integerSetting(
  'GROUPGUARD_WHATSAPP_ACTION_TIMEOUT_MS',
  15 * 1000,
  1_000,
  60_000,
);

export const RECONNECT_MAX_ATTEMPTS = integerSetting('GROUPGUARD_RECONNECT_MAX_ATTEMPTS', 8, 1, 20);
export const RECONNECT_BASE_DELAY_MS = integerSetting('GROUPGUARD_RECONNECT_BASE_DELAY_MS', 1000, 250, 60_000);
export const RECONNECT_MAX_DELAY_MS = integerSetting(
  'GROUPGUARD_RECONNECT_MAX_DELAY_MS',
  60 * 1000,
  1_000,
  10 * 60 * 1000,
);
if (RECONNECT_MAX_DELAY_MS < RECONNECT_BASE_DELAY_MS) {
  throw new Error('GROUPGUARD_RECONNECT_MAX_DELAY_MS must be at least the base delay');
}

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(HOME_DIR, '.config', 'groupguard', 'mount-allowlist.json');
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE = process.env.CONTAINER_IMAGE || 'groupguard-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(process.env.CONTAINER_TIMEOUT || '300000', 10);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760', 10); // 10MB default
export const IPC_POLL_INTERVAL = 1000;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(`^@${escapeRegex(ASSISTANT_NAME)}\\b`, 'i');

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
