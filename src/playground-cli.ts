import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

import { DATA_DIR, PUBLIC_PLAYGROUND_ENABLED, STORE_DIR } from './config.js';
import { parseRegisteredGroups, SAFE_STARTER_GUARDS } from './group-config.js';
import { loadJson, saveJson } from './utils.js';

const configPath = path.join(DATA_DIR, 'registered_groups.json');
const envPath = path.resolve('.env');
const auditKeyPath = path.join(STORE_DIR, 'playground-audit.key');
const DEFAULT_SETUP_URL = 'https://github.com/TomGranot/groupguard#quick-start';

function updateEnvSetting(name: string, value: string): void {
  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8').split('\n') : [];
  const prefix = `${name}=`;
  const index = lines.findIndex((line) => line.trimStart().startsWith(prefix));
  if (index >= 0) lines[index] = `${name}=${value}`;
  else lines.push(`${name}=${value}`);
  fs.writeFileSync(envPath, `${lines.filter((line, lineIndex) => line || lineIndex < lines.length - 1).join('\n')}\n`, {
    mode: 0o600,
  });
  if (process.platform !== 'win32') fs.chmodSync(envPath, 0o600);
}

function usage(): never {
  console.log(`
Usage:
  npm run playground -- status
  npm run playground -- enable <group-folder> --dedicated-account [--setup-url https://...]
  npm run playground -- disable <group-folder>
`);
  process.exit(1);
}

const parsed = parseRegisteredGroups(loadJson<unknown>(configPath, {}));
if (parsed.errors.length > 0) {
  console.error(`Invalid group configuration:\n${parsed.errors.join('\n')}`);
  process.exit(1);
}

const groups = parsed.groups;
const command = process.argv[2] || 'status';
const folder = process.argv[3];

if (command === 'status') {
  console.log('\nGroupGuard playground status\n');
  for (const group of Object.values(groups)) {
    const mode = group.playground?.enabled ? 'PLAYGROUND' : 'standard';
    console.log(`  ${group.folder.padEnd(24)} ${mode}  ${group.name}`);
  }
  console.log(`\nGlobal playground gate: ${PUBLIC_PLAYGROUND_ENABLED ? 'open' : 'closed'}\n`);
  process.exit(0);
}

if (!folder || !['enable', 'disable'].includes(command)) usage();
const entry = Object.entries(groups).find(([, group]) => group.folder === folder);
if (!entry) {
  console.error(`Unknown group folder: ${folder}`);
  usage();
}

const [jid, group] = entry;
if (command === 'enable') {
  if (!process.argv.includes('--dedicated-account')) {
    console.error('Refusing to enable a public playground without --dedicated-account.');
    console.error('Use a separate WhatsApp number and a separate GroupGuard installation.');
    process.exit(1);
  }
  if (Object.keys(groups).length !== 1) {
    console.error('A playground installation must contain exactly one registered group.');
    process.exit(1);
  }
  if (folder === 'main') {
    console.error('The privileged main group cannot become a public playground.');
    process.exit(1);
  }

  const urlFlag = process.argv.indexOf('--setup-url');
  const setupUrl = urlFlag >= 0 ? process.argv[urlFlag + 1] : DEFAULT_SETUP_URL;
  if (!setupUrl) usage();

  groups[jid] = {
    ...group,
    guards: SAFE_STARTER_GUARDS.map((guard) => ({ ...guard, params: { ...guard.params } })),
    moderationConfig: {
      observationMode: true,
      adminExempt: true,
      dmCooldownSeconds: 300,
      notifyOnDelete: false,
    },
    playground: {
      enabled: true,
      setupUrl,
      cooldownSeconds: 60,
      maxResponsesPerMinute: 6,
    },
  };

  const validation = parseRegisteredGroups(groups);
  if (validation.errors.length > 0) {
    console.error(`Playground configuration rejected:\n${validation.errors.join('\n')}`);
    process.exit(1);
  }

  updateEnvSetting('GROUPGUARD_PUBLIC_PLAYGROUND_ENABLED', 'true');
  updateEnvSetting('GROUPGUARD_AGENT_ENABLED', 'false');
  updateEnvSetting('GROUPGUARD_AGENT_PROJECT_WRITE_ENABLED', 'false');
  updateEnvSetting('GROUPGUARD_ENFORCEMENT_ENABLED', 'false');
  updateEnvSetting('GROUPGUARD_TYPING_INDICATOR_ENABLED', 'false');
  fs.mkdirSync(STORE_DIR, { recursive: true });
  if (!fs.existsSync(auditKeyPath)) {
    fs.writeFileSync(auditKeyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
  }
  if (process.platform !== 'win32') fs.chmodSync(auditKeyPath, 0o600);
  console.log(`Public playground enabled for ${group.name}.`);
  console.log('Agent execution, enforcement, DMs, and typing indicators are disabled.');
} else {
  groups[jid] = {
    ...group,
    playground: group.playground ? { ...group.playground, enabled: false } : undefined,
  };
  updateEnvSetting('GROUPGUARD_PUBLIC_PLAYGROUND_ENABLED', 'false');
  console.log(`Public playground disabled for ${group.name}.`);
}

saveJson(configPath, groups);
if (process.platform !== 'win32') fs.chmodSync(configPath, 0o600);
console.log('Restart GroupGuard, then run npm run doctor.');
