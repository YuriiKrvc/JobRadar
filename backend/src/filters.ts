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

export function applyHardFilters(posting: RawPosting, profile: Profile): FilterResult {
  const location = (posting.location ?? '').toLowerCase();
  if (profile.excludedLocations.some((x) => location.includes(x.toLowerCase()))) {
    return { passed: false, rule: 'location' };
  }

  if (profile.allowedEmploymentTypes.length > 0 && posting.employmentType) {
    const type = posting.employmentType.toLowerCase();
    const ok = profile.allowedEmploymentTypes.some((x) => type.includes(x.toLowerCase()));
    if (!ok) return { passed: false, rule: 'employment-type' };
  }

  if (profile.minSalaryUsd !== null) {
    const stated = statedSalaryUsd(posting.description);
    if (stated !== null && stated < profile.minSalaryUsd) {
      return { passed: false, rule: 'salary' };
    }
  }

  return { passed: true };
}
