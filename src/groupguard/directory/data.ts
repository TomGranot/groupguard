import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeDirectoryRequest, type DirectorySnapshot, type Taxonomy } from './responder.js';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value.trim();
}

function stringArray(value: unknown, label: string, maximumItems: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error(`${label} must be an array`);
  return value.map((item, index) => stringValue(item, `${label}[${index}]`, 256));
}

function stableId(value: unknown, label: string): string {
  const id = stringValue(value, label, 128);
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(id)) throw new Error(`${label} must be a stable lowercase ID`);
  return id;
}

export function parseTaxonomy(value: unknown): Taxonomy {
  const input = objectValue(value, 'taxonomy');
  const version = stringValue(input.version, 'taxonomy.version', 128);
  if (!Array.isArray(input.categories) || input.categories.length === 0 || input.categories.length > 500) {
    throw new Error('taxonomy.categories must contain 1 to 500 categories');
  }

  const categoryIds = new Set<string>();
  const aliasOwners = new Map<string, string>();
  const categories = input.categories.map((candidate, index) => {
    const category = objectValue(candidate, `taxonomy.categories[${index}]`);
    const id = stableId(category.id, `taxonomy.categories[${index}].id`);
    if (categoryIds.has(id)) throw new Error(`Duplicate category ID: ${id}`);
    categoryIds.add(id);
    const title = stringValue(category.title, `taxonomy.categories[${index}].title`, 160);
    const aliases = stringArray(category.aliases ?? [], `taxonomy.categories[${index}].aliases`, 100);
    const examples = category.examples === undefined
      ? undefined
      : stringArray(category.examples, `taxonomy.categories[${index}].examples`, 100);

    for (const alias of [title, ...aliases]) {
      const normalized = normalizeDirectoryRequest(alias);
      const existing = aliasOwners.get(normalized);
      if (existing && existing !== id) throw new Error(`Directory alias collision between ${existing} and ${id}: ${alias}`);
      aliasOwners.set(normalized, id);
    }
    return { id, title, aliases, ...(examples ? { examples } : {}) };
  });
  return { version, categories };
}

export function parseDirectorySnapshot(value: unknown, taxonomy: Taxonomy): DirectorySnapshot {
  const input = objectValue(value, 'directory');
  const version = stringValue(input.version, 'directory.version', 128);
  if (!Array.isArray(input.providers) || input.providers.length > 10_000) {
    throw new Error('directory.providers must be an array of at most 10000 providers');
  }
  const allowedCategories = new Set(taxonomy.categories.map((category) => category.id));
  const providerIds = new Set<string>();
  const providers = input.providers.map((candidate, index) => {
    const provider = objectValue(candidate, `directory.providers[${index}]`);
    const id = stableId(provider.id, `directory.providers[${index}].id`);
    if (providerIds.has(id)) throw new Error(`Duplicate provider ID: ${id}`);
    providerIds.add(id);
    const categoryIds = stringArray(provider.categoryIds, `directory.providers[${index}].categoryIds`, 50);
    if (categoryIds.length === 0 || categoryIds.some((categoryId) => !allowedCategories.has(categoryId))) {
      throw new Error(`Provider ${id} references an unknown or empty category list`);
    }
    const name = stringValue(provider.name, `directory.providers[${index}].name`, 200);
    if (!Array.isArray(provider.contacts) || provider.contacts.length === 0 || provider.contacts.length > 20) {
      throw new Error(`Provider ${id} must have 1 to 20 public contacts`);
    }
    const contacts = provider.contacts.map((candidateContact, contactIndex) => {
      const contact = objectValue(candidateContact, `provider ${id} contact ${contactIndex}`);
      return {
        label: stringValue(contact.label, `provider ${id} contact label`, 80),
        value: stringValue(contact.value, `provider ${id} contact value`, 500),
      };
    });
    let recommendation;
    if (provider.recommendation !== undefined) {
      const evidence = objectValue(provider.recommendation, `provider ${id} recommendation`);
      recommendation = {
        quote: stringValue(evidence.quote, `provider ${id} recommendation quote`, 2_000),
        ...(evidence.attribution === undefined
          ? {}
          : { attribution: stringValue(evidence.attribution, `provider ${id} recommendation attribution`, 200) }),
      };
    }
    return { id, categoryIds, name, contacts, ...(recommendation ? { recommendation } : {}) };
  });
  return { version, providers };
}

export interface AtomicDirectoryStoreOptions {
  source: string;
  cachePath: string;
  taxonomy: Taxonomy;
  fetchImpl?: FetchImplementation;
  timeoutMs?: number;
}

export class AtomicDirectoryStore {
  private snapshot: DirectorySnapshot | undefined;
  private readonly fetchImpl: FetchImplementation;

  constructor(private readonly options: AtomicDirectoryStoreOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  current(): DirectorySnapshot | undefined {
    return this.snapshot;
  }

  async loadCache(): Promise<DirectorySnapshot | undefined> {
    try {
      const value = JSON.parse(await readFile(this.options.cachePath, 'utf8')) as unknown;
      this.snapshot = parseDirectorySnapshot(value, this.options.taxonomy);
      return this.snapshot;
    } catch {
      return undefined;
    }
  }

  async refresh(): Promise<DirectorySnapshot> {
    let value: unknown;
    if (/^https?:\/\//iu.test(this.options.source)) {
      const response = await this.fetchImpl(this.options.source, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
      if (!response.ok) throw new Error(`Directory source returned HTTP ${response.status}`);
      value = (await response.json()) as unknown;
    } else {
      value = JSON.parse(await readFile(this.options.source, 'utf8')) as unknown;
    }

    const validated = parseDirectorySnapshot(value, this.options.taxonomy);
    await mkdir(path.dirname(this.options.cachePath), { recursive: true });
    const temporaryPath = `${this.options.cachePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.options.cachePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    this.snapshot = validated;
    return validated;
  }
}
