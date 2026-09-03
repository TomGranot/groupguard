import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createInitialConfig, inspectInstallation, setEnforcementMode } from './operations.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'groupguard-operations-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('createInitialConfig', () => {
  it('writes a private, strict config without exposing the group ID in its result', async () => {
    const root = await temporaryDirectory();
    const result = await createInitialConfig({ projectRoot: root, groupId: '123456789012345678@g.us' });

    expect(result).toEqual({ configPath: path.join(root, 'config', 'groupguard.json'), configuredGroups: 1 });
    expect((await stat(result.configPath)).mode & 0o777).toBe(0o600);
    const config = JSON.parse(await readFile(result.configPath, 'utf8')) as { groups: Record<string, unknown> };
    expect(Object.keys(config.groups)).toEqual(['123456789012345678@g.us']);
  });

  it('refuses to overwrite an existing config', async () => {
    const root = await temporaryDirectory();
    await createInitialConfig({ projectRoot: root, groupId: '123456789012345678@g.us' });
    await expect(createInitialConfig({ projectRoot: root, groupId: '123456789012345678@g.us' })).rejects.toThrow(
      'already exists',
    );
  });
});

describe('inspectInstallation', () => {
  it('reports safe readiness facts without returning group IDs', async () => {
    const root = await temporaryDirectory();
    await createInitialConfig({ projectRoot: root, groupId: '123456789012345678@g.us' });
    await writeFile(path.join(root, 'config', 'taxonomy.json'), JSON.stringify({ version: '1', categories: [] }));

    const report = await inspectInstallation({
      projectRoot: root,
      nodeVersion: '22.12.0',
      fetchImpl: async () => new Response('ok'),
    });

    expect(report.checks.find((check) => check.id === 'config')).toMatchObject({
      ok: true,
      detail: '1 group configured',
    });
    expect(JSON.stringify(report)).not.toContain('@g.us');
    expect(report.ready).toBe(false);
  });
});

describe('setEnforcementMode', () => {
  it('refuses enforcement until the observation period is complete', async () => {
    const root = await temporaryDirectory();
    const groupId = '123456789012345678@g.us';
    await createInitialConfig({ projectRoot: root, groupId });

    await expect(setEnforcementMode({ projectRoot: root, groupId, mode: 'enable', now: new Date() })).rejects.toThrow(
      'observation period',
    );
  });

  it('uses both the group policy and the host lock to enable enforcement', async () => {
    const root = await temporaryDirectory();
    const groupId = '123456789012345678@g.us';
    const created = await createInitialConfig({ projectRoot: root, groupId });
    const raw = JSON.parse(await readFile(created.configPath, 'utf8')) as {
      groups: Record<string, { moderation: { observationStartedAt: string } }>;
    };
    raw.groups[groupId].moderation.observationStartedAt = '2026-01-01T00:00:00.000Z';
    await writeFile(created.configPath, `${JSON.stringify(raw, null, 2)}\n`);

    const result = await setEnforcementMode({
      projectRoot: root,
      groupId,
      mode: 'enable',
      now: new Date('2026-01-03T00:00:00.000Z'),
    });

    expect(result).toEqual({ mode: 'enabled' });
    expect(await readFile(path.join(root, '.env'), 'utf8')).toContain('GROUPGUARD_ENFORCEMENT_ENABLED=true');
    const updated = JSON.parse(await readFile(created.configPath, 'utf8')) as {
      groups: Record<string, { moderation: { observationMode: boolean } }>;
    };
    expect(updated.groups[groupId].moderation.observationMode).toBe(false);
  });
});
