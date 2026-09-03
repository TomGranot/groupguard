import { describe, expect, it, vi } from 'vitest';

import { OllamaCategoryClassifier } from './ollama-classifier.js';
import type { Taxonomy } from './responder.js';

const taxonomy: Taxonomy = {
  version: 'example-v1',
  categories: [
    { id: 'home-moving', title: 'Home moving', aliases: ['movers'], examples: ['Who can move a sofa?'] },
    { id: 'home-repair', title: 'Home repair', aliases: ['handyman'], examples: ['I need a shelf fixed.'] },
  ],
};

function ollamaResponse(content: string): Response {
  return new Response(JSON.stringify({ message: { content } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Ollama category classifier', () => {
  it('asks qwen3:4b to choose only from the closed taxonomy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ollamaResponse(JSON.stringify({ categoryId: 'home-moving', confidence: 0.91 })),
    );
    const classifier = new OllamaCategoryClassifier({ fetchImpl });

    await expect(classifier.classify('Could someone relocate my sofa?', taxonomy)).resolves.toEqual({
      categoryId: 'home-moving',
      confidence: 0.91,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'qwen3:4b', stream: false, keep_alive: '25h' });
    expect(body.messages[0].content).toContain('home-moving');
    expect(body.messages[0].content).toContain('Return null when the message is not a service-provider request');
  });

  it('rejects malformed output and category IDs outside the taxonomy', async () => {
    const malformed = new OllamaCategoryClassifier({ fetchImpl: vi.fn().mockResolvedValue(ollamaResponse('not json')) });
    const unknown = new OllamaCategoryClassifier({
      fetchImpl: vi.fn().mockResolvedValue(ollamaResponse(JSON.stringify({ categoryId: 'unknown', confidence: 0.99 }))),
    });

    await expect(malformed.classify('Anything', taxonomy)).resolves.toBeNull();
    await expect(unknown.classify('Anything', taxonomy)).resolves.toBeNull();
  });

  it('caches repeated normalized messages for one taxonomy version', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ollamaResponse(JSON.stringify({ categoryId: 'home-repair', confidence: 0.88 })),
    );
    const classifier = new OllamaCategoryClassifier({ fetchImpl });

    await classifier.classify('Fix a shelf!', taxonomy);
    await classifier.classify('  fix a shelf  ', taxonomy);

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('prewarms the configured model without a chat message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const classifier = new OllamaCategoryClassifier({ fetchImpl });

    await classifier.prewarm();

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/api/generate');
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'qwen3:4b', prompt: '', keep_alive: '25h' });
  });
});
