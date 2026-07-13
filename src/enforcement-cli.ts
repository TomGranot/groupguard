import fs from 'fs';
import path from 'path';

import { DATA_DIR, MIN_OBSERVATION_HOURS } from './config.js';
import { parseRegisteredGroups } from './group-config.js';
import { loadJson, saveJson } from './utils.js';

const configPath = path.join(DATA_DIR, 'registered_groups.json');
const envPath = path.resolve('.env');

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
  npm run enforcement -- status
  npm run enforcement -- enable <group-folder>
  npm run enforcement -- disable <group-folder>
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
  console.log('\nGroupGuard enforcement status\n');
  for (const group of Object.values(groups)) {
    const mode = group.moderationConfig?.observationMode === false ? 'ENFORCING' : 'observing';
    console.log(`  ${group.folder.padEnd(24)} ${mode}  ${group.name}`);
  }
  console.log('\nThe global operator lock is read from .env. Run npm run doctor to verify it.\n');
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
  const addedAt = new Date(group.added_at).getTime();
  if (!Number.isFinite(addedAt)) {
    console.error(`Group ${folder} has an invalid added_at timestamp.`);
    process.exit(1);
  }
  const observedHours = (Date.now() - addedAt) / (60 * 60 * 1000);
  if (observedHours < MIN_OBSERVATION_HOURS) {
    const remaining = Math.ceil(MIN_OBSERVATION_HOURS - observedHours);
    console.error(
      `Group ${folder} needs ${remaining} more observation hour(s) before enforcement can be enabled.`,
    );
    process.exit(1);
  }

  groups[jid] = {
    ...group,
    moderationConfig: { ...group.moderationConfig!, observationMode: false },
  };
  updateEnvSetting('GROUPGUARD_ENFORCEMENT_ENABLED', 'true');
  console.log(`Enforcement enabled for ${group.name}.`);
} else {
  groups[jid] = {
    ...group,
    moderationConfig: { ...group.moderationConfig!, observationMode: true },
  };
  const anyEnforcing = Object.values(groups).some(
    (candidate) => candidate.moderationConfig?.observationMode === false,
  );
  if (!anyEnforcing) updateEnvSetting('GROUPGUARD_ENFORCEMENT_ENABLED', 'false');
  console.log(`Observation mode restored for ${group.name}.`);
}

saveJson(configPath, groups);
if (process.platform !== 'win32') fs.chmodSync(configPath, 0o600);
console.log('Restart GroupGuard, then run npm run doctor.');
