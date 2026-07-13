import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import {
  AGENT_ENABLED,
  DATA_DIR,
  ENFORCEMENT_ENABLED,
  PUBLIC_PLAYGROUND_ENABLED,
  STORE_DIR,
  TYPING_INDICATOR_ENABLED,
} from './config.js';
import { parseRegisteredGroups } from './group-config.js';
import { loadJson } from './utils.js';

let failures = 0;
let warnings = 0;

function pass(message: string): void {
  console.log(`  OK    ${message}`);
}

function fail(message: string): void {
  failures += 1;
  console.log(`  FAIL  ${message}`);
}

function warn(message: string): void {
  warnings += 1;
  console.log(`  WARN  ${message}`);
}

function privateMode(filePath: string): boolean {
  if (process.platform === 'win32') return true;
  return (fs.statSync(filePath).mode & 0o077) === 0;
}

function checkNode(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) pass(`Node.js ${process.versions.node}`);
  else fail(`Node.js 20 or newer is required; found ${process.versions.node}`);
}

function checkEnvironment(): void {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) {
    warn('.env is missing; safe defaults apply, but setup state is not explicit');
  } else if (!privateMode(envPath)) {
    warn('.env is readable by other local users; run chmod 600 .env');
  } else {
    pass('.env permissions');
  }
}

function checkAuth(): void {
  const credentialsPath = path.join(STORE_DIR, 'auth', 'creds.json');
  if (!fs.existsSync(credentialsPath)) {
    fail('WhatsApp is not linked; run npm run auth');
    return;
  }

  const credentials = loadJson<{ registered?: boolean }>(credentialsPath, {});
  if (!credentials.registered) fail('WhatsApp credentials are incomplete; run npm run auth');
  else pass('WhatsApp linked-device credentials');

  if (!privateMode(credentialsPath)) warn('WhatsApp credentials are readable by other local users');
}

function checkGroups(): void {
  const configPath = path.join(DATA_DIR, 'registered_groups.json');
  const parsed = parseRegisteredGroups(loadJson<unknown>(configPath, {}));
  for (const error of parsed.errors) fail(`Group config: ${error}`);

  const groups = Object.values(parsed.groups);
  if (groups.length === 0) {
    fail('No groups are registered; run npm run groups');
    return;
  }
  pass(`${groups.length} group(s) registered`);

  const enforcing = groups.filter((group) => !group.moderationConfig?.observationMode);
  if (!ENFORCEMENT_ENABLED) {
    pass('Operator enforcement lock is closed');
    if (enforcing.length > 0) {
      warn(`${enforcing.length} group(s) request enforcement but remain locked to observation`);
    }
  } else if (enforcing.length === 0) {
    warn('Operator enforcement lock is open, but every group remains in observation mode');
  } else {
    warn(`Enforcement is active for ${enforcing.length} group(s); monitor moderation logs closely`);
  }
}

function checkAgent(): void {
  if (!AGENT_ENABLED) {
    pass('Moderation-only mode; Docker and AI credentials are not required');
    return;
  }

  const docker = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 });
  if (docker.status === 0) pass('Docker is available for the optional agent');
  else fail('The optional agent is enabled, but Docker is unavailable');

  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    pass('Agent authentication is configured');
  } else {
    fail('The optional agent needs ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN');
  }
}

function checkPlayground(): void {
  const configPath = path.join(DATA_DIR, 'registered_groups.json');
  const parsed = parseRegisteredGroups(loadJson<unknown>(configPath, {}));
  const playgrounds = Object.values(parsed.groups).filter((group) => group.playground?.enabled);

  if (playgrounds.length === 0) {
    if (PUBLIC_PLAYGROUND_ENABLED) warn('Public playground gate is open, but no group uses it');
    return;
  }

  if (!PUBLIC_PLAYGROUND_ENABLED) {
    fail('A group requests playground mode, but the local playground gate is closed');
  } else {
    pass('Public playground gate is open');
  }
  if (Object.keys(parsed.groups).length !== 1) {
    fail('A public playground must use a dedicated installation with exactly one group');
  }
  if (AGENT_ENABLED) fail('The AI agent must remain disabled on a public playground');
  if (ENFORCEMENT_ENABLED) fail('The global enforcement lock must remain closed on a public playground');
  if (TYPING_INDICATOR_ENABLED) fail('Typing indicators must remain disabled on a public playground');
  if (playgrounds.some((group) => group.folder === 'main')) {
    fail('The privileged main group cannot be a public playground');
  }
  if (playgrounds.some((group) => !group.moderationConfig?.observationMode)) {
    fail('A public playground group must remain in observation mode');
  }
  if (playgrounds.some((group) => group.moderationConfig?.notifyOnDelete)) {
    fail('Moderation DMs must remain disabled on a public playground');
  }
  if (playgrounds.some((group) => (group.playground?.cooldownSeconds || 0) < 60)) {
    fail('A public playground visitor cooldown must be at least 60 seconds');
  }
  if (playgrounds.some((group) => (group.playground?.maxResponsesPerMinute || 0) > 6)) {
    fail('A public playground may send at most six responses per minute');
  }
  const auditKeyPath = path.join(STORE_DIR, 'playground-audit.key');
  if (!fs.existsSync(auditKeyPath)) {
    fail('Playground audit key is missing; re-run npm run playground -- enable');
  } else if (!privateMode(auditKeyPath)) {
    fail('Playground audit key is readable by other local users');
  } else if (fs.statSync(auditKeyPath).size < 32) {
    fail('Playground audit key is too short; disable and re-enable the playground');
  } else {
    pass('Playground audit pseudonym key');
  }
  warn('Confirm this installation uses a separate WhatsApp number');
}

console.log('\nGroupGuard doctor\n');
checkNode();
checkEnvironment();
checkAuth();
checkGroups();
checkAgent();
checkPlayground();
console.log(`\n${failures} failure(s), ${warnings} warning(s)\n`);
process.exitCode = failures > 0 ? 1 : 0;
