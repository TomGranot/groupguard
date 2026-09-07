function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function mentions(text: string, name: string): boolean {
  const words = normalize(text).split(/\s+/u);
  const nameWords = normalize(name).split(/\s+/u);
  if (nameWords.join('').length < 3) return false;
  return words.some((_word, start) =>
    nameWords.every((expected, offset) => {
      const actual = words[start + offset] || '';
      return (
        actual === expected ||
        (/^[\u0590-\u05ff]+$/u.test(expected) &&
          /^[בלמהו]{1,2}$/u.test(actual.slice(0, -expected.length)) &&
          actual.endsWith(expected))
      );
    }),
  );
}

/** Only explicit named exclusions count; a mention or method preference alone does not. */
export function isProviderExcluded(text: string, provider: { name: string; aliases?: string[] }): boolean {
  const names = [provider.name, ...provider.name.split(/[()]/u), ...(provider.aliases || [])].filter((name) =>
    name.trim(),
  );
  const clauses = text.split(/[.!?;\n]/u);
  return clauses.some((clause) => {
    const normalized = normalize(clause);
    const exclusion = /(?:^| )(?:חוץ מ|מלבד|למעט|לא כולל|בלי|לא את|other than |except |excluding |not )(.*)$/u.exec(
      normalized,
    );
    if (!exclusion) return false;
    const scope = exclusion[1].split(/(?: אבל | אך | but | instead )/u)[0].slice(0, 120);
    return names.some((name) => mentions(scope, name));
  });
}
