import { normalizeDirectoryRequest, type CategoryClassification, type CategoryClassifier, type Taxonomy } from './responder.js';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OllamaCategoryClassifierOptions {
  baseUrl?: string;
  model?: string;
  keepAlive?: string;
  timeoutMs?: number;
  cacheSize?: number;
  fetchImpl?: FetchImplementation;
}

interface OllamaChatResponse {
  message?: { content?: string };
}

function closedTaxonomyPrompt(taxonomy: Taxonomy): string {
  const categories = taxonomy.categories.map((category) => ({
    id: category.id,
    title: category.title,
    examples: category.examples ?? [],
  }));
  return [
    'You classify messages for a service-provider directory.',
    'Choose exactly one category ID from the closed list below.',
    'Return null when the message is not a service-provider request or when the category is uncertain.',
    'Do not invent categories. Do not answer the message.',
    'Return only JSON with categoryId and confidence.',
    `Taxonomy version: ${taxonomy.version}`,
    JSON.stringify(categories),
  ].join('\n');
}

function parseClassification(content: string, taxonomy: Taxonomy): CategoryClassification | null {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.categoryId === null) return null;
  if (typeof record.categoryId !== 'string' || typeof record.confidence !== 'number') return null;
  if (!Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) return null;
  if (!taxonomy.categories.some((category) => category.id === record.categoryId)) return null;
  return { categoryId: record.categoryId, confidence: record.confidence };
}

export class OllamaCategoryClassifier implements CategoryClassifier {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly keepAlive: string;
  private readonly timeoutMs: number;
  private readonly cacheSize: number;
  private readonly fetchImpl: FetchImplementation;
  private readonly cache = new Map<string, CategoryClassification | null>();

  constructor(options: OllamaCategoryClassifierOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/u, '');
    this.model = options.model ?? 'qwen3:4b';
    this.keepAlive = options.keepAlive ?? '25h';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.cacheSize = options.cacheSize ?? 1_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async classify(text: string, taxonomy: Taxonomy): Promise<CategoryClassification | null> {
    const cacheKey = `${taxonomy.version}:${normalizeDirectoryRequest(text)}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey) ?? null;

    let result: CategoryClassification | null = null;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          keep_alive: this.keepAlive,
          options: { temperature: 0 },
          format: {
            type: 'object',
            properties: {
              categoryId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['categoryId', 'confidence'],
          },
          messages: [
            { role: 'system', content: closedTaxonomyPrompt(taxonomy) },
            { role: 'user', content: text },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.ok) {
        const payload = (await response.json()) as OllamaChatResponse;
        result = parseClassification(payload.message?.content ?? '', taxonomy);
      }
    } catch {
      result = null;
    }

    this.cache.set(cacheKey, result);
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return result;
  }

  async prewarm(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: '', stream: false, keep_alive: this.keepAlive }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
