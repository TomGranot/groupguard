// General service-directory policy. Taxonomy aliases must describe services, not contact preferences.
export interface EvidenceCategory {
  id: string;
  title: string;
  shortTitle?: string;
  aliases?: string[];
}

export function normalizeCategoryLabel(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('he')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const GENERIC_CATEGORY_TOKENS = new Set([
  'פרטי',
  'פרטית',
  'נוסף',
  'נוספים',
  'נוספות',
  'איש',
  'אנשי',
  'בעל',
  'בעלי',
  'ילד',
  'ילדים',
  'ייעוץ',
  'מומחה',
  'מומחים',
  'מקצועי',
  'מקצועיים',
  'נותן',
  'נותני',
  'רופא',
  'רופאי',
  'רופאה',
  'רופאות',
  'שירות',
  'שירותי',
  'שירותים',
  'תינוק',
  'תינוקות',
  'תיקון',
  'תיקונים',
]);

function containsNormalizedPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function hebrewTokenMatches(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  let candidate = actual;
  for (let prefixCount = 0; prefixCount < 2 && candidate.length > expected.length; prefixCount += 1) {
    if (!'בלמהו'.includes(candidate[0])) break;
    candidate = candidate.slice(1);
    if (candidate === expected) return true;
  }
  return false;
}

function containsHebrewPhrase(text: string, phrase: string): boolean {
  if (containsNormalizedPhrase(text, phrase)) return true;
  const textTokens = text.split(' ');
  const phraseTokens = phrase.split(' ');
  return textTokens.some(
    (_token, start) =>
      start + phraseTokens.length <= textTokens.length &&
      phraseTokens.every((expected, offset) => hebrewTokenMatches(textTokens[start + offset], expected)),
  );
}

function containsHebrewToken(textTokens: Set<string>, expected: string): boolean {
  return [...textTokens].some((token) => hebrewTokenMatches(token, expected));
}

function isGenericCategoryToken(token: string): boolean {
  if (GENERIC_CATEGORY_TOKENS.has(token)) return true;
  return token.length > 4 && 'בלמהו'.includes(token[0]) && GENERIC_CATEGORY_TOKENS.has(token.slice(1));
}

/**
 * Returns only categories supported by literal evidence in the inbound text.
 * The model may reject or disambiguate these candidates, but cannot introduce
 * a category that the message never mentioned.
 */
export function findCategoryCandidates(text: string, categories: EvidenceCategory[]): string[] {
  const normalizedText = normalizeCategoryLabel(text);
  if (!normalizedText) return [];
  const textTokens = new Set(normalizedText.split(' '));

  return categories
    .filter((category) => {
      const labels = [category.title, category.shortTitle || '', ...(category.aliases || [])]
        .map(normalizeCategoryLabel)
        .filter(Boolean);
      if (labels.some((label) => containsHebrewPhrase(normalizedText, label))) return true;

      // Hebrew service requests often inflect the first word of a phrase,
      // such as "לתקן נזילה" for the alias "תיקון נזילה". A distinctive
      // noun still provides category evidence while generic service words do not.
      return (category.aliases || []).map(normalizeCategoryLabel).some((label) => {
        const anchors = label.split(' ').filter((token) => token.length >= 4 && !isGenericCategoryToken(token));
        return anchors.length > 0 && anchors.every((token) => containsHebrewToken(textTokens, token));
      });
    })
    .map((category) => category.id)
    .slice(0, 4);
}

const DIRECT_PROVIDER_SEARCH_PATTERN =
  /(?:^| )(?:מחפש|מחפשת|מחפשים|מחפשות|זקוק|זקוקה|צריך|צריכה|צריכים|צריכות)(?: |ים )/u;

const PROVIDER_REQUEST_PATTERNS = [
  /(?:^| )(?:can|could) (?:someone|anyone|you) (?:please )?(?:recommend|suggest|help|refer|relocate|move)(?: |$)/u,
  /(?:^| )(?:who|anyone) (?:can|knows|know|recommend)(?: |$)/u,
  /(?:^| )(?:looking for|searching for|need|recommendations for|recommendations on)(?: |$)/u,
  /(?:^| )(?:מכירים|מכירות|מכיר|מכירה)(?: |$)/u,
  /(?:^| )(?:יש|למישהו יש|למישהי יש) (?:לך|לכם|למישהו|למישהי) (?:להמליץ|\S+(?: \S+){0,5} מומלצ)/u,
  /(?:^| )(?:יש למישהו|יש למישהי|יש לכם|יש לך) (?!ניסיון|נסיון|מושג)(?:\S+ ){0,8}\S+/u,
  /(?:^| )(?:אפשר|תוכל|תוכלי|יכולים|יכול|יכולה|תוכלו) (?:בבקשה )?להמליץ(?: |$)/u,
  /(?:^| )(?:אשמח|נשמח|אפשר) (?:ל)?פרטים(?: |$)/u,
  /(?:^| )(?:יש|ישנה|ישנם) (?:למישהו |למישהי |לכם |פה |כאן )?[^.!]{0,100}(?:המלצ|מכיר|מכירים|פרטי קשר)/u,
  /(?:^| )(?:למישהו|למישהי) יש (?:כאן |פה )?[^.!]{0,100}(?:המלצ|מכיר|פרטי קשר)/u,
  /(?:^| )(?:אשמח|נשמח|אפשר|מבקש|מבקשת|מבקשים) [^.!]{0,100}(?:המלצ|הפניה|פרטי קשר)/u,
  DIRECT_PROVIDER_SEARCH_PATTERN,
  /(?:^| )(?:המלצה|המלצות) (?:על |ל\S+|עבור )/u,
  /(?:^| )מי (?:מכיר|מכירה|ממליץ|ממליצה)(?: |ים )/u,
  /(?:^| )מישהו (?:מכיר|מכירה|יכול להמליץ|יכולה להמליץ)(?: |ים )/u,
  /(?:^| )[^.!?]{0,100}יש חיה כזאת(?: |\?|$)/u,
];

const META_DISCUSSION_PATTERNS = [
  /(?:הלוגיקה|האלגוריתם|המודל|הפרומפט) [^.!]{0,50}(?:בוט|מסווג|קטגור)/u,
  /(?:הבוט|בוט) [^.!]{0,50}(?:עובד|בוחר|מציג|מדרג|מעדכן|מסווג)/u,
  /(?:למשל|לדוגמה) (?:אני )?(?:מחפש|מחפשת|מחפשים|מחפשות)/u,
  /(?:^| )(?:אם|כש)[^.!]{0,80}(?:מחפש|מחפשת|מחפשים|מחפשות)[^.!]{0,80}(?:הבוט|בוט)(?: |$)/u,
];

const NEGATED_PROVIDER_SEARCH_PATTERN = /(?:^| )לא (?:באמת )?(?:מחפש|מחפשת|מחפשים|מחפשות|זקוק|זקוקה)(?: |ים )/u;

const PRODUCT_RECOMMENDATION_PATTERNS = [
  /(?:המלצה|המלצות) על (?:סוג )?אופניים(?: |$)/u,
  /(?:מחפש|מחפשת) [^.!]{0,60}(?:יד שניה|יד שנייה)/u,
];

const PROVIDER_ADVERTISEMENT_PATTERNS = [
  /(?:הבייביסיטר|המטפלת|המטפל) שלנו [^.!]{0,80}מחפש(?:ת|ים|ות)? (?:להתחיל|משפחה)/u,
  /(?:מטפלת|מטפל|בייביסיטר) [^.!]{0,80}מחפש(?:ת|ים|ות)? משפחה/u,
  /מחפש(?:ת|ים|ות)? משפחה חדשה (?:לטפל|לעבוד)/u,
];

const RECOMMENDATION_GIVING_PATTERNS = [
  /(?:מוסיף|מוסיפה|נותן|נותנת) (?:גם )?את ההמלצה שלי/u,
  /(?:^| )המלצה שלי(?: |$)/u,
];

/** High-precision public-action gate. Missing or ambiguous intent stays silent. */
export function hasProviderRequestEvidence(text: string): boolean {
  const normalizedText = normalizeCategoryLabel(text);
  if (
    !normalizedText ||
    META_DISCUSSION_PATTERNS.some((pattern) => pattern.test(normalizedText)) ||
    PRODUCT_RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(normalizedText)) ||
    PROVIDER_ADVERTISEMENT_PATTERNS.some((pattern) => pattern.test(normalizedText)) ||
    RECOMMENDATION_GIVING_PATTERNS.some((pattern) => pattern.test(normalizedText))
  ) {
    return false;
  }
  const hasNonSearchRequest = PROVIDER_REQUEST_PATTERNS.some(
    (pattern) => pattern !== DIRECT_PROVIDER_SEARCH_PATTERN && pattern.test(normalizedText),
  );
  if (NEGATED_PROVIDER_SEARCH_PATTERN.test(normalizedText) && !hasNonSearchRequest) return false;
  return PROVIDER_REQUEST_PATTERNS.some((pattern) => pattern.test(normalizedText));
}
