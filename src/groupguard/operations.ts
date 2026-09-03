import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadGroupGuardConfig, parseGroupGuardConfig } from './config.js';
import { parseDirectorySnapshot, parseTaxonomy } from './directory/data.js';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface InstallationCheck {
  id: 'node' | 'config' | 'whatsapp-auth' | 'directory' | 'ollama';
  ok: boolean;
  detail: string;
}

export interface InstallationReport {
  ready: boolean;
  checks: InstallationCheck[];
}

const STARTER_TAXONOMY = {
  version: 'starter-1',
  categories: [
    {
      id: 'home-repair',
      title: 'Home repair',
      aliases: ['handyman', 'repair service'],
      examples: ['Can anyone recommend somebody to repair a broken cabinet?'],
    },
    {
      id: 'wellness',
      title: 'Wellness',
      aliases: ['wellness professional'],
      examples: ['I am looking for a wellness professional nearby.'],
    },
  ],
};

const STARTER_DIRECTORY = {
  version: 'starter-1',
  providers: [],
};

export async function createInitialConfig(options: {
  projectRoot: string;
  groupId: string;
}): Promise<{ configPath: string; configuredGroups: number }> {
  if (!/^\d{8,20}@g\.us$/u.test(options.groupId)) {
    throw new Error('The group ID must be a WhatsApp group JID ending in @g.us');
  }
  const configDirectory = path.join(options.projectRoot, 'config');
  const configPath = path.join(configDirectory, 'groupguard.json');
  await mkdir(configDirectory, { recursive: true });

  const configInput = {
    schemaVersion: 1,
    directory: {
      taxonomyPath: 'config/taxonomy.json',
      source: 'config/directory.json',
      cachePath: 'data/groupguard/directory-cache.json',
      model: 'qwen3:4b',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      minimumConfidence: 0.72,
      refreshHours: 24,
      keepAlive: '25h',
    },
    groups: {
      [options.groupId]: {
        directoryEnabled: true,
        forwardUnmatchedToAgent: false,
        moderation: {
          observationMode: true,
          adminExempt: true,
          notifyOnDelete: false,
          minimumObservationHours: 24,
          observationStartedAt: new Date().toISOString(),
          guards: [{ id: 'no-spam', enabled: true, params: { maxMessages: 5, windowSeconds: 10 } }],
        },
      },
    },
  } as const;
  const config = parseGroupGuardConfig(configInput);

  await writeFile(configPath, `${JSON.stringify(configInput, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') throw new Error(`GroupGuard config already exists at ${configPath}`);
    throw error;
  });
  await writeFile(path.join(configDirectory, 'taxonomy.json'), `${JSON.stringify(STARTER_TAXONOMY, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await writeFile(path.join(configDirectory, 'directory.json'), `${JSON.stringify(STARTER_DIRECTORY, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });

  return { configPath, configuredGroups: Object.keys(config.groups).length };
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function resolveLocal(projectRoot: string, candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.resolve(projectRoot, candidate);
}

export async function inspectInstallation(options: {
  projectRoot: string;
  configPath?: string;
  nodeVersion?: string;
  fetchImpl?: FetchImplementation;
}): Promise<InstallationReport> {
  const checks: InstallationCheck[] = [];
  const major = Number((options.nodeVersion ?? process.versions.node).split('.')[0]);
  checks.push({ id: 'node', ok: major >= 22, detail: major >= 22 ? `Node ${major}` : 'Node 22 or newer is required' });

  const configPath = resolveLocal(options.projectRoot, options.configPath ?? 'config/groupguard.json');
  let config;
  try {
    config = await loadGroupGuardConfig(configPath);
    const count = Object.keys(config.groups).length;
    checks.push({ id: 'config', ok: count > 0, detail: `${count} group${count === 1 ? '' : 's'} configured` });
  } catch {
    checks.push({ id: 'config', ok: false, detail: 'Configuration is missing or invalid' });
  }

  const authReady = await exists(path.join(options.projectRoot, 'store', 'auth', 'creds.json'));
  checks.push({
    id: 'whatsapp-auth',
    ok: authReady,
    detail: authReady ? 'Linked-device session found' : 'WhatsApp pairing is required',
  });

  if (!config?.directory) {
    checks.push({ id: 'directory', ok: true, detail: 'Directory responses are disabled' });
    checks.push({ id: 'ollama', ok: true, detail: 'Local classifier is not required' });
  } else {
    try {
      const taxonomy = parseTaxonomy(
        JSON.parse(await readFile(resolveLocal(options.projectRoot, config.directory.taxonomyPath), 'utf8')) as unknown,
      );
      if (/^https?:\/\//iu.test(config.directory.source)) {
        checks.push({ id: 'directory', ok: true, detail: 'Remote directory source configured' });
      } else {
        const snapshot = parseDirectorySnapshot(
          JSON.parse(await readFile(resolveLocal(options.projectRoot, config.directory.source), 'utf8')) as unknown,
          taxonomy,
        );
        checks.push({ id: 'directory', ok: true, detail: `${snapshot.providers.length} providers validated` });
      }
    } catch {
      checks.push({ id: 'directory', ok: false, detail: 'Taxonomy or directory source is missing or invalid' });
    }

    try {
      const response = await (options.fetchImpl ?? fetch)(
        `${config.directory.ollamaBaseUrl.replace(/\/$/u, '')}/api/tags`,
        {
          signal: AbortSignal.timeout(3_000),
        },
      );
      checks.push({
        id: 'ollama',
        ok: response.ok,
        detail: response.ok ? 'Ollama is reachable' : 'Ollama is not ready',
      });
    } catch {
      checks.push({ id: 'ollama', ok: false, detail: 'Ollama is not reachable' });
    }
  }

  return { ready: checks.every((check) => check.ok), checks };
}

async function atomicPrivateWrite(destination: string, content: string): Promise<void> {
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}

async function setEnvValue(envPath: string, key: string, value: string): Promise<void> {
  let source = '';
  try {
    source = await readFile(envPath, 'utf8');
  } catch {
    // A new installation may not have an .env file yet.
  }
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'mu');
  const updated = pattern.test(source)
    ? source.replace(pattern, line)
    : `${source.trimEnd()}${source.trim().length > 0 ? '\n' : ''}${line}\n`;
  await atomicPrivateWrite(envPath, updated);
}

export async function setEnforcementMode(options: {
  projectRoot: string;
  groupId: string;
  mode: 'observe' | 'enable';
  now?: Date;
}): Promise<{ mode: 'observation' | 'enabled' }> {
  const configPath = path.join(options.projectRoot, 'config', 'groupguard.json');
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  const validated = parseGroupGuardConfig(raw);
  const policy = validated.groups[options.groupId];
  if (!policy) throw new Error('The requested group is not configured');
  const now = options.now ?? new Date();
  const rawGroups = raw.groups as Record<string, { moderation?: Record<string, unknown> }>;
  const rawModeration = rawGroups[options.groupId].moderation ?? {};

  if (options.mode === 'enable') {
    const started = policy.moderation.observationStartedAt
      ? Date.parse(policy.moderation.observationStartedAt)
      : Number.NaN;
    const requiredMs = policy.moderation.minimumObservationHours * 60 * 60_000;
    if (!Number.isFinite(started) || now.getTime() - started < requiredMs) {
      throw new Error(`The ${policy.moderation.minimumObservationHours}-hour observation period is not complete`);
    }
    rawModeration.observationMode = false;
    rawGroups[options.groupId].moderation = rawModeration;
    parseGroupGuardConfig(raw);
    await atomicPrivateWrite(configPath, `${JSON.stringify(raw, null, 2)}\n`);
    await setEnvValue(path.join(options.projectRoot, '.env'), 'GROUPGUARD_ENFORCEMENT_ENABLED', 'true');
    return { mode: 'enabled' };
  }

  rawModeration.observationMode = true;
  rawModeration.observationStartedAt = now.toISOString();
  rawGroups[options.groupId].moderation = rawModeration;
  parseGroupGuardConfig(raw);
  await atomicPrivateWrite(configPath, `${JSON.stringify(raw, null, 2)}\n`);
  await setEnvValue(path.join(options.projectRoot, '.env'), 'GROUPGUARD_ENFORCEMENT_ENABLED', 'false');
  return { mode: 'observation' };
}
