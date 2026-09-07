import { describe, expect, it, vi } from 'vitest';
import { findCategoryCandidates, hasProviderRequestEvidence } from './request-policy.js';
import { isProviderExcluded } from './provider-exclusions.js';
import { DirectoryResponder, type Taxonomy } from './responder.js';
import { OllamaCategoryClassifier } from './ollama-classifier.js';

// All names and utterances below are synthetic.
const taxonomy: Taxonomy = {
  version: 'synthetic-v2',
  categories: [
    { id: 'childcare', title: 'מסגרות לילדים', aliases: ['גן', 'גנים', 'גן ילדים'] },
    { id: 'catering', title: 'קייטרינג', aliases: ['שף פרטי'] },
    { id: 'packing', title: 'אריזה', aliases: ['שירותי אריזה'] },
  ],
};

describe('service request evidence', () => {
  it('requires service evidence instead of private-contact wording', () => {
    expect(findCategoryCandidates('מחפשת גן בחיפה, אפשר תשובה בפרטי?', taxonomy.categories)).toEqual(['childcare']);
    expect(findCategoryCandidates('שלחו פרטים נוספים בפרטי', taxonomy.categories)).toEqual([]);
    expect(findCategoryCandidates('צריכה שף פרטי לאירוע עסקי', taxonomy.categories)).toEqual(['catering']);
  });

  it.each(['מכירים גנים בחיפה?', 'אפשר פרטים של גן?', 'יש לך להמליץ שירותי אריזה בצפון?', 'אשמח לפרטים של חברת אריזה'])(
    'admits colloquial provider requests: %s',
    (text) => {
      expect(hasProviderRequestEvidence(text)).toBe(true);
    },
  );

  it.each(['מה נהוג לשאול בראיון?', 'הבוט מציג נותני שירות', 'אני לא מחפש מוביל', 'המלצה שלי על נותן השירות'])(
    'rejects discussion and recommendations being given: %s',
    (text) => {
      expect(hasProviderRequestEvidence(text)).toBe(false);
    },
  );

  it('refuses an unrelated but known category even when a classifier returns high confidence', async () => {
    const classify = vi.fn().mockResolvedValue({ categoryId: 'catering', confidence: 0.99 });
    const responder = new DirectoryResponder({
      taxonomy,
      snapshot: { version: 'v1', providers: [] },
      classifier: { classify },
    });
    expect(await responder.respond({ messageId: 'synthetic', text: 'מחפשת גן בחיפה, אפשר תשובה בפרטי?' })).toBeNull();
    expect(classify.mock.calls[0][1].categories.map((category: { id: string }) => category.id)).toEqual(['childcare']);
  });

  it('bounds the model schema to evidenced categories and refuses a known category outside that set', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ message: { content: JSON.stringify({ categoryId: 'catering', confidence: 0.99 }) } }),
        ),
      );
    expect(await new OllamaCategoryClassifier({ fetchImpl }).classify('מכירים גנים בחיפה?', taxonomy)).toBeNull();
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.format.properties.categoryId.anyOf[0].enum).toEqual(['childcare']);
  });

  it('does not call the model when no service is supported by the taxonomy', async () => {
    const fetchImpl = vi.fn();
    expect(
      await new OllamaCategoryClassifier({ fetchImpl }).classify('Can anyone recommend hiking trails?', taxonomy),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('explicit provider exclusions', () => {
  const provider = { name: 'AquaExample (אקווהדוגמה)' };
  it.each(['חוץ מאקווהדוגמה', 'מלבד אקווהדוגמה', 'למעט אקווהדוגמה', 'except AquaExample', 'other than AquaExample'])(
    'matches a named exclusion: %s',
    (text) => {
      expect(isProviderExcluded(text, provider)).toBe(true);
    },
  );
  it.each([
    'מישהו מכיר את אקווהדוגמה?',
    'בלי שיטות קשוחות. שמעתי על אקווהדוגמה',
    'מלבד מקום אחר, אבל אקווהדוגמה מתאים',
  ])('does not mistake an unrelated exclusion or mention for an excluded provider: %s', (text) => {
    expect(isProviderExcluded(text, provider)).toBe(false);
  });

  it('filters before recommendation priority and distinguishes all-excluded from an empty directory', async () => {
    const snapshot = {
      version: 'v1',
      providers: [
        {
          id: 'excluded',
          categoryIds: ['childcare'],
          name: 'Nursery Example',
          contacts: [{ label: 'Website', value: 'https://example.test/' }],
          recommendation: { quote: 'Synthetic endorsement' },
        },
      ],
    };
    const responder = new DirectoryResponder({
      taxonomy,
      snapshot,
      classifier: { classify: vi.fn().mockResolvedValue({ categoryId: 'childcare', confidence: 0.99 }) },
    });
    const result = await responder.respond({ messageId: 'synthetic', text: 'מכירים גנים? except Nursery Example' });
    expect(result?.providerIds).toEqual([]);
    expect(result?.text).toContain('No other matching providers');
    expect(result?.text).not.toContain('Nursery Example');
  });
});
