import type { RawPosting } from './types';
import type { Profile } from './settings/schema';

export type FilterResult = { passed: true } | { passed: false; rule: string };

const SALARY_RE = /\$\s?(\d[\d,\s]{2,})/g;

export function statedSalaryUsd(text: string): number | null {
  const values: number[] = [];
  for (const m of text.matchAll(SALARY_RE)) {
    const n = Number(m[1]!.replace(/[,\s]/g, ''));
    if (Number.isFinite(n) && n > 0) values.push(n);
  }
  return values.length ? Math.max(...values) : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word, case-insensitive, first match wins; returns the entry that
 * matched so the rejection can name it.
 *
 * The boundary is a lookaround over letters/digits rather than `\b`, and it is
 * applied only at the ends of the entry that ARE alphanumeric. `\b` would break
 * both directions: `\bc\+\+\b` never matches "C++ developer" because the
 * trailing `\b` demands a word character after the plus, and a leading boundary
 * on `.net` would never match "ASP.NET" because the preceding character is a
 * letter.
 */
export function matchBlockedWord(text: string, words: string[]): string | null {
  for (const word of words) {
    const entry = word.trim();
    if (entry === '') continue;

    const alnum = '[\\p{L}\\p{N}]';
    const lead = /^[\p{L}\p{N}]/u.test(entry) ? `(?<!${alnum})` : '';
    const tail = /[\p{L}\p{N}]$/u.test(entry) ? `(?!${alnum})` : '';

    // The trimmed entry, not the raw one: the caller writes this into
    // scores.reasoning, which is persisted and shown in the dashboard, so a
    // list entry saved as " php " must not leave stray whitespace there.
    if (new RegExp(`${lead}${escapeRegex(entry)}${tail}`, 'iu').test(text)) return entry;
  }
  return null;
}

export function applyTitleFilter(posting: RawPosting, words: string[]): FilterResult {
  const hit = matchBlockedWord(posting.title, words);
  return hit ? { passed: false, rule: `title-word:${hit}` } : { passed: true };
}

export function applyHardFilters(
  posting: RawPosting,
  profile: Profile,
  descriptionWords: string[],
): FilterResult {
  const location = (posting.location ?? '').toLowerCase();
  if (profile.excludedLocations.some((x) => location.includes(x.toLowerCase()))) {
    return { passed: false, rule: 'location' };
  }

  if (profile.allowedEmploymentTypes.length > 0 && posting.employmentType) {
    const type = posting.employmentType.toLowerCase();
    const ok = profile.allowedEmploymentTypes.some((x) => type.includes(x.toLowerCase()));
    if (!ok) return { passed: false, rule: 'employment-type' };
  }

  const blocked = matchBlockedWord(posting.description, descriptionWords);
  if (blocked) return { passed: false, rule: `description-word:${blocked}` };

  if (profile.minSalaryUsd !== null) {
    const stated = statedSalaryUsd(posting.description);
    if (stated !== null && stated < profile.minSalaryUsd) {
      return { passed: false, rule: 'salary' };
    }
  }

  return { passed: true };
}
