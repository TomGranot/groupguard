import { createHash } from 'node:crypto';

export interface DirectoryCategory {
  id: string;
  title: string;
  aliases: string[];
  examples?: string[];
}

export interface Taxonomy {
  version: string;
  categories: DirectoryCategory[];
}

export interface ProviderContact {
  label: string;
  value: string;
}

export interface RecommendationEvidence {
  quote: string;
  attribution?: string;
}

export interface DirectoryProvider {
  id: string;
  categoryIds: string[];
  name: string;
  contacts: ProviderContact[];
  recommendation?: RecommendationEvidence;
}

export interface DirectorySnapshot {
  version: string;
  providers: DirectoryProvider[];
}

export interface CategoryClassification {
  categoryId: string;
  confidence: number;
}

export interface CategoryClassifier {
  classify(text: string, taxonomy: Taxonomy): Promise<CategoryClassification | null>;
}

export interface DirectoryResponse {
  categoryId: string;
  providerIds: string[];
  text: string;
}

export interface DirectoryResponderOptions {
  taxonomy: Taxonomy;
  snapshot: DirectorySnapshot;
  classifier: CategoryClassifier;
  minimumConfidence?: number;
}

const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

export function normalizeDirectoryRequest(value: string): string {
  return value
    .normalize('NFKC')
    .replace(BIDI_CONTROLS, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function deterministicRandom(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32BE(0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function choose<T>(items: readonly T[], count: number, seed: string): T[] {
  const shuffled = [...items];
  const random = deterministicRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return shuffled.slice(0, count);
}

function selectProviders(providers: readonly DirectoryProvider[], messageId: string): DirectoryProvider[] {
  if (providers.length <= 2) {
    const recommended = providers.filter((provider) => provider.recommendation?.quote.trim());
    const remaining = providers.filter((provider) => !recommended.includes(provider));
    return [...recommended, ...remaining].slice(0, 2);
  }

  const recommended = providers.filter((provider) => provider.recommendation?.quote.trim());
  if (recommended.length >= 2) return choose(recommended, 2, `${messageId}:recommended`);
  if (recommended.length === 1) {
    const remaining = providers.filter((provider) => provider.id !== recommended[0]!.id);
    return [recommended[0]!, ...choose(remaining, 1, `${messageId}:remaining`)];
  }
  return choose(providers, 2, `${messageId}:all`);
}

function renderProvider(provider: DirectoryProvider, index: number): string {
  const lines = [`${index + 1}. *${provider.name}*`];
  for (const contact of provider.contacts) lines.push(`   ${contact.label}: ${contact.value}`);
  if (provider.recommendation?.quote.trim()) {
    const attribution = provider.recommendation.attribution?.trim();
    lines.push(`   _Recommended by a community member:_ “${provider.recommendation.quote.trim()}”${attribution ? ` (${attribution})` : ''}`);
  }
  return lines.join('\n');
}

function renderResponse(category: DirectoryCategory, providers: readonly DirectoryProvider[]): string {
  const title = `🤖 *${category.title}*`;
  if (providers.length === 0) {
    return `${title}\n\nNo providers are currently listed for this service on the directory website.`;
  }
  return `${title}\n\n${providers.map(renderProvider).join('\n\n')}`;
}

export class DirectoryResponder {
  private readonly categoriesById: ReadonlyMap<string, DirectoryCategory>;
  private readonly categoryByAlias: ReadonlyMap<string, DirectoryCategory>;
  private readonly minimumConfidence: number;

  constructor(private readonly options: DirectoryResponderOptions) {
    this.categoriesById = new Map(options.taxonomy.categories.map((category) => [category.id, category]));
    const aliases = new Map<string, DirectoryCategory>();
    for (const category of options.taxonomy.categories) {
      for (const alias of [category.title, ...category.aliases]) {
        const normalized = normalizeDirectoryRequest(alias);
        if (normalized) aliases.set(normalized, category);
      }
    }
    this.categoryByAlias = aliases;
    this.minimumConfidence = options.minimumConfidence ?? 0.72;
  }

  async respond(request: { messageId: string; text: string }): Promise<DirectoryResponse | null> {
    const normalized = normalizeDirectoryRequest(request.text);
    if (!normalized) return null;

    let category = this.categoryByAlias.get(normalized);
    if (!category) {
      let classification: CategoryClassification | null;
      try {
        classification = await this.options.classifier.classify(request.text, this.options.taxonomy);
      } catch {
        return null;
      }
      if (!classification || classification.confidence < this.minimumConfidence) return null;
      category = this.categoriesById.get(classification.categoryId);
      if (!category) return null;
    }

    const eligible = this.options.snapshot.providers.filter((provider) => provider.categoryIds.includes(category.id));
    const selected = selectProviders(eligible, request.messageId);
    return {
      categoryId: category.id,
      providerIds: selected.map((provider) => provider.id),
      text: renderResponse(category, selected),
    };
  }
}
