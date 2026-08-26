import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS, parseFilters, toSearchParams, toApiFilters,
  type UiFilters,
} from '../src/api/filters-url';

describe('parseFilters', () => {
  it('returns the defaults for an empty query string', () => {
    expect(parseFilters(new URLSearchParams(''))).toEqual(DEFAULT_FILTERS);
  });

  it('reads every supported parameter', () => {
    const ui = parseFilters(new URLSearchParams(
      'verdict=STRONG&source=djinni&provider=anthropic&minTotal=60&since=7d&sort=asc&rejected=1',
    ));

    expect(ui).toEqual({
      verdict: 'STRONG', source: 'djinni', provider: 'anthropic',
      minTotal: 60, since: '7d', sort: 'asc', showRejected: true,
    });
  });

  it('ignores an unknown verdict rather than throwing', () => {
    expect(parseFilters(new URLSearchParams('verdict=BANANA')).verdict).toBe('any');
  });

  it('ignores an unknown since window', () => {
    expect(parseFilters(new URLSearchParams('since=fortnight')).since).toBe('any');
  });

  it('clamps a min score outside 0-100', () => {
    expect(parseFilters(new URLSearchParams('minTotal=999')).minTotal).toBe(100);
    expect(parseFilters(new URLSearchParams('minTotal=-5')).minTotal).toBe(0);
  });

  it('ignores a non-numeric min score', () => {
    expect(parseFilters(new URLSearchParams('minTotal=lots')).minTotal).toBe(0);
  });
});

describe('toSearchParams', () => {
  it('omits every value that is at its default', () => {
    expect(toSearchParams(DEFAULT_FILTERS).toString()).toBe('');
  });

  it('serialises only what differs from the default', () => {
    const ui: UiFilters = { ...DEFAULT_FILTERS, verdict: 'MAYBE', minTotal: 50 };
    expect(toSearchParams(ui).toString()).toBe('verdict=MAYBE&minTotal=50');
  });

  it('round-trips any filter set', () => {
    const ui: UiFilters = {
      verdict: 'NO', source: 'dou', provider: 'hard-filter',
      minTotal: 25, since: '30d', sort: 'asc', showRejected: true,
    };
    expect(parseFilters(toSearchParams(ui))).toEqual(ui);
  });
});

describe('toApiFilters', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');

  it('drops the UI-only keys and the "any" sentinels', () => {
    expect(toApiFilters(DEFAULT_FILTERS, now)).toEqual({ limit: 500 });
  });

  it('turns a since window into a concrete date', () => {
    const ui: UiFilters = { ...DEFAULT_FILTERS, since: '7d' };
    expect(toApiFilters(ui, now).since).toBe('2026-08-19');
  });

  it('passes through the real filters', () => {
    const ui: UiFilters = { ...DEFAULT_FILTERS, verdict: 'STRONG', source: 'djinni', minTotal: 70 };
    expect(toApiFilters(ui, now)).toEqual({
      verdict: 'STRONG', source: 'djinni', minTotal: 70, limit: 500,
    });
  });

  it('never sends sort or rejected to the API', () => {
    const ui: UiFilters = { ...DEFAULT_FILTERS, sort: 'asc', showRejected: true };
    expect(Object.keys(toApiFilters(ui, now))).toEqual(['limit']);
  });
});
