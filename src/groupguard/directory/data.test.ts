import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AtomicDirectoryStore, parseDirectorySnapshot, parseTaxonomy } from './data.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const taxonomyInput = {
  version: 'example-v1',
  categories: [
    { id: 'home-moving', title: 'Home moving', aliases: ['movers'], examples: ['Move a sofa'] },
    { id: 'home-repair', title: 'Home repair', aliases: ['handyman'] },
  ],
};

const directoryInput = {
  version: 'directory-v1',
  providers: [
    {
      id: 'provider-a',
      categoryIds: ['home-moving'],
      name: 'Northwind Moving',
      contacts: [{ label: 'Website', value: 'https://northwind.example.test' }],
      recommendation: { quote: 'Careful and punctual.' },
    },
  ],
};

describe('directory data contract', () => {
  it('validates a closed taxonomy and provider snapshot', () => {
    const taxonomy = parseTaxonomy(taxonomyInput);
    const snapshot = parseDirectorySnapshot(directoryInput, taxonomy);

    expect(snapshot.providers[0]?.categoryIds).toEqual(['home-moving']);
  });

  it('rejects alias collisions and unknown provider categories', () => {
    expect(() =>
      parseTaxonomy({
        version: 'collision-v1',
        categories: [
          { id: 'first', title: 'First', aliases: ['shared'] },
          { id: 'second', title: 'Second', aliases: ['Shared!'] },
        ],
      }),
    ).toThrow(/alias/i);

    const taxonomy = parseTaxonomy(taxonomyInput);
    expect(() =>
      parseDirectorySnapshot(
        {
          ...directoryInput,
          providers: [{ ...directoryInput.providers[0], categoryIds: ['not-in-taxonomy'] }],
        },
        taxonomy,
      ),
    ).toThrow(/category/i);
  });

  it('keeps the last valid snapshot when a refresh is invalid', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'groupguard-directory-'));
    temporaryDirectories.push(directory);
    const cachePath = path.join(directory, 'directory.json');
    const responses = [directoryInput, { version: 'broken', providers: [{ nope: true }] }];
    const fetchImpl = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const taxonomy = parseTaxonomy(taxonomyInput);
    const store = new AtomicDirectoryStore({ source: 'https://directory.example.test/providers.json', cachePath, taxonomy, fetchImpl });

    await expect(store.refresh()).resolves.toMatchObject({ version: 'directory-v1' });
    await expect(store.refresh()).rejects.toThrow();
    expect(store.current()?.version).toBe('directory-v1');
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toMatchObject({ version: 'directory-v1' });
  });
});
