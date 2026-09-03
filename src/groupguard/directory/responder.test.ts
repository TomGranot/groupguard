import { describe, expect, it, vi } from 'vitest';

import {
  DirectoryResponder,
  type CategoryClassifier,
  type DirectorySnapshot,
  type Taxonomy,
} from './responder.js';

const taxonomy: Taxonomy = {
  version: 'example-v1',
  categories: [
    { id: 'home-moving', title: 'Home moving', aliases: ['movers', 'moving company'] },
    { id: 'home-repair', title: 'Home repair', aliases: ['handyman'] },
  ],
};

const snapshot: DirectorySnapshot = {
  version: 'example-directory-v1',
  providers: [
    {
      id: 'provider-a',
      categoryIds: ['home-moving'],
      name: 'Northwind Moving',
      contacts: [{ label: 'Website', value: 'https://northwind.example.test' }],
      recommendation: { quote: 'Careful, punctual, and easy to work with.' },
    },
    {
      id: 'provider-b',
      categoryIds: ['home-moving'],
      name: 'Harbor Transport',
      contacts: [{ label: 'Email', value: 'hello@harbor.example.test' }],
    },
    {
      id: 'provider-c',
      categoryIds: ['home-moving'],
      name: 'Maple Relocation',
      contacts: [{ label: 'Website', value: 'https://maple.example.test' }],
      recommendation: { quote: 'Handled a difficult move calmly.' },
    },
  ],
};

function classifier(result: Awaited<ReturnType<CategoryClassifier['classify']>>): CategoryClassifier {
  return { classify: vi.fn().mockResolvedValue(result) };
}

describe('GroupGuard directory responder', () => {
  it('uses an exact whole-message alias without invoking Qwen', async () => {
    const semantic = classifier(null);
    const responder = new DirectoryResponder({ taxonomy, snapshot, classifier: semantic });

    const response = await responder.respond({ messageId: 'request-a', text: '  Movers!  ' });

    expect(semantic.classify).not.toHaveBeenCalled();
    expect(response?.categoryId).toBe('home-moving');
    expect(response?.text).toContain('🤖 *Home moving*');
  });

  it('uses semantic classification for natural-language requests', async () => {
    const semantic = classifier({ categoryId: 'home-moving', confidence: 0.93 });
    const responder = new DirectoryResponder({ taxonomy, snapshot, classifier: semantic });

    const response = await responder.respond({ messageId: 'request-b', text: 'Who can help relocate my furniture?' });

    expect(semantic.classify).toHaveBeenCalledOnce();
    expect(response?.categoryId).toBe('home-moving');
  });

  it.each(['Good morning everyone', '@GroupGuard'])('stays silent for non-service text: %s', async (text) => {
    const responder = new DirectoryResponder({ taxonomy, snapshot, classifier: classifier(null) });

    await expect(responder.respond({ messageId: 'request-c', text })).resolves.toBeNull();
  });

  it('reports when a known category has no providers', async () => {
    const responder = new DirectoryResponder({ taxonomy, snapshot, classifier: classifier(null) });

    const response = await responder.respond({ messageId: 'request-d', text: 'handyman' });

    expect(response?.providerIds).toEqual([]);
    expect(response?.text).toContain('No providers are currently listed');
  });

  it('selects two recommended providers before providers without evidence', async () => {
    const responder = new DirectoryResponder({ taxonomy, snapshot, classifier: classifier(null) });

    const response = await responder.respond({ messageId: 'request-e', text: 'movers' });

    expect(response?.providerIds.sort()).toEqual(['provider-a', 'provider-c']);
    expect(response?.text.match(/Recommended by a community member/g)).toHaveLength(2);
  });

  it('keeps one recommended provider and fills the second slot from the full list', async () => {
    const oneRecommendation: DirectorySnapshot = {
      ...snapshot,
      providers: snapshot.providers.map((provider) =>
        provider.id === 'provider-c' ? { ...provider, recommendation: undefined } : provider,
      ),
    };
    const responder = new DirectoryResponder({ taxonomy, snapshot: oneRecommendation, classifier: classifier(null) });

    const response = await responder.respond({ messageId: 'request-f', text: 'movers' });

    expect(response?.providerIds).toHaveLength(2);
    expect(response?.providerIds[0]).toBe('provider-a');
  });

  it('selects no more than two providers from the full list when none has evidence', async () => {
    const noRecommendations: DirectorySnapshot = {
      ...snapshot,
      providers: snapshot.providers.map(({ recommendation: _recommendation, ...provider }) => provider),
    };
    const responder = new DirectoryResponder({ taxonomy, snapshot: noRecommendations, classifier: classifier(null) });

    const response = await responder.respond({ messageId: 'request-g', text: 'movers' });

    expect(response?.providerIds).toHaveLength(2);
    expect(response?.text).not.toContain('Recommended by a community member');
  });

  it('reuses the same random selection for a retried message ID', async () => {
    const noRecommendations: DirectorySnapshot = {
      ...snapshot,
      providers: snapshot.providers.map(({ recommendation: _recommendation, ...provider }) => provider),
    };
    const responder = new DirectoryResponder({ taxonomy, snapshot: noRecommendations, classifier: classifier(null) });

    const first = await responder.respond({ messageId: 'stable-request', text: 'movers' });
    const retry = await responder.respond({ messageId: 'stable-request', text: 'movers' });

    expect(retry?.providerIds).toEqual(first?.providerIds);
  });
});
