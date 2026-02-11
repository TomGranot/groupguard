import { Guard, GuardContext, GuardResult } from './types.js';

const pass: GuardResult = { blocked: false };

function block(guardId: string, reason: string): GuardResult {
  return { blocked: true, guardId, reason };
}

// Cache compiled regexes per group to avoid recompiling on every message
const regexCache = new Map<string, RegExp[]>();

function getCompiledPatterns(config: { params?: Record<string, unknown> }, chatJid: string): RegExp[] {
  const patterns = (config.params?.patterns as string[]) || [];
  const keywords = (config.params?.keywords as string[]) || [];

  // Simple cache key — invalidates if list changes length
  const cacheKey = `${chatJid}:${patterns.length}:${keywords.length}`;
  const cached = regexCache.get(cacheKey);
  if (cached) return cached;

  const compiled: RegExp[] = [];

  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern, 'i'));
    } catch {
      // Skip invalid regex patterns silently
    }
  }

  for (const keyword of keywords) {
    // Escape special regex chars and match as whole word
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    compiled.push(new RegExp(`\\b${escaped}\\b`, 'i'));
  }

  regexCache.set(cacheKey, compiled);
  return compiled;
}

export const keywordFilterGuard: Guard = {
  id: 'keyword-filter',
  name: 'Keyword Filter',
  description: 'Block messages matching keyword/regex patterns. Set params.keywords (string[]) and/or params.patterns (regex string[]).',
  evaluate: (ctx: GuardContext): GuardResult => {
    if (!ctx.textContent) return pass;

    const compiled = getCompiledPatterns(ctx.config, ctx.chatJid);
    if (compiled.length === 0) return pass;

    for (const regex of compiled) {
      if (regex.test(ctx.textContent)) {
        return block('keyword-filter', 'Your message was blocked by a content filter.');
      }
    }
    return pass;
  },
};

export const keywordGuards: Guard[] = [keywordFilterGuard];
