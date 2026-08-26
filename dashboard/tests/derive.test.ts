import { describe, it, expect } from 'vitest';
import {
  isHardFiltered, ruleOf, rejectionSentence, isNearMiss, nearMissGap,
  isStale, pipCount, bandKey, relativeTime, groupByDay,
} from '../src/postings/derive';
import type { PostingRow } from '../src/api/types';

const DIM = { score: 0, note: 'n' };
const SUBSCORES = {
  coreStack: DIM, seniority: DIM, domain: DIM, logistics: DIM, growth: DIM,
};

function row(over: Partial<PostingRow> = {}): PostingRow {
  return {
    postingId: 'x:1', title: 'T', company: 'C', url: 'https://e.com/1',
    source: 'djinni', location: 'Remote', total: 80, verdict: 'STRONG',
    reasoning: 'ok', providerId: 'anthropic', settingsVersion: '3',
    scoredAt: '2026-08-26T10:00:00.000Z', subscores: SUBSCORES, ...over,
  };
}

describe('hard-filtered rows', () => {
  it('identifies a row scored by the hard filter', () => {
    expect(isHardFiltered(row({ providerId: 'hard-filter' }))).toBe(true);
    expect(isHardFiltered(row())).toBe(false);
  });

  it('reads the rule out of the reasoning string', () => {
    expect(ruleOf(row({ providerId: 'hard-filter', reasoning: 'hard-filter:location' })))
      .toBe('location');
  });

  it('returns null for a normally scored row', () => {
    expect(ruleOf(row())).toBeNull();
  });

  it('turns each known rule into a sentence naming when it fired', () => {
    expect(rejectionSentence('location')).toMatch(/excluded location/i);
    expect(rejectionSentence('employment-type')).toMatch(/employment type/i);
    expect(rejectionSentence('salary')).toMatch(/salary/i);
  });

  it('falls back to a sentence naming an unknown rule verbatim', () => {
    expect(rejectionSentence('title-word:php')).toContain('title-word:php');
  });
});

describe('near miss', () => {
  it.each([
    [39, false], [40, true], [49, true], [50, false],
  ])('total %i is a near miss: %s', (total, expected) => {
    expect(isNearMiss(row({ total, verdict: 'NO' }))).toBe(expected);
  });

  it('is never a near miss when the verdict is not NO', () => {
    expect(isNearMiss(row({ total: 45, verdict: 'MAYBE' }))).toBe(false);
  });

  it('reports how far under the MAYBE band it landed', () => {
    expect(nearMissGap(row({ total: 44, verdict: 'NO' }))).toBe(6);
  });
});

describe('stale scores', () => {
  it('is stale when the score predates the current settings version', () => {
    expect(isStale(row({ settingsVersion: '2' }), 3)).toBe(true);
  });

  it('is not stale at the current version', () => {
    expect(isStale(row({ settingsVersion: '3' }), 3)).toBe(false);
  });

  it('is not stale when the current version is unknown', () => {
    expect(isStale(row({ settingsVersion: '2' }), null)).toBe(false);
  });
});

describe('verdict carriers', () => {
  it('fills three, two and one pip', () => {
    expect(pipCount('STRONG')).toBe(3);
    expect(pipCount('MAYBE')).toBe(2);
    expect(pipCount('NO')).toBe(1);
  });

  it('maps a verdict to its ink-weight class key', () => {
    expect(bandKey('STRONG')).toBe('strong');
    expect(bandKey('NO')).toBe('no');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');

  it.each([
    ['2026-08-26T11:58:00.000Z', 'now'],
    ['2026-08-26T11:00:00.000Z', '1h'],
    ['2026-08-26T06:00:00.000Z', '6h'],
    ['2026-08-23T12:00:00.000Z', '3d'],
  ])('renders %s as %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });
});

describe('groupByDay', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');

  it('labels the buckets Today, Yesterday and N days ago', () => {
    const groups = groupByDay([
      row({ postingId: 'a', scoredAt: '2026-08-26T09:00:00.000Z' }),
      row({ postingId: 'b', scoredAt: '2026-08-25T09:00:00.000Z' }),
      row({ postingId: 'c', scoredAt: '2026-08-22T09:00:00.000Z' }),
    ], now, true);

    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', '4 days ago']);
  });

  it('sorts by total inside a day, not across days', () => {
    const groups = groupByDay([
      row({ postingId: 'a', total: 40, scoredAt: '2026-08-26T09:00:00.000Z' }),
      row({ postingId: 'b', total: 90, scoredAt: '2026-08-25T09:00:00.000Z' }),
      row({ postingId: 'c', total: 70, scoredAt: '2026-08-26T08:00:00.000Z' }),
    ], now, true);

    expect(groups[0]!.rows.map((r) => r.total)).toEqual([70, 40]);
    expect(groups[1]!.rows.map((r) => r.total)).toEqual([90]);
  });

  it('reverses the within-day order when ascending', () => {
    const groups = groupByDay([
      row({ postingId: 'a', total: 40, scoredAt: '2026-08-26T09:00:00.000Z' }),
      row({ postingId: 'c', total: 70, scoredAt: '2026-08-26T08:00:00.000Z' }),
    ], now, false);

    expect(groups[0]!.rows.map((r) => r.total)).toEqual([40, 70]);
  });

  it('buckets by UTC calendar date, not by elapsed hours', () => {
    // 23:30 yesterday is 1.5 hours before 01:00 today, but a different day.
    const groups = groupByDay([
      row({ postingId: 'a', scoredAt: '2026-08-26T01:00:00.000Z' }),
      row({ postingId: 'b', scoredAt: '2026-08-25T23:30:00.000Z' }),
    ], new Date('2026-08-26T02:00:00.000Z'), true);

    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
  });

  it('carries the calendar date on each group', () => {
    const groups = groupByDay([row({ scoredAt: '2026-08-26T09:00:00.000Z' })], now, true);
    expect(groups[0]!.date).toBe('26 August');
  });

  it('returns no groups for no rows', () => {
    expect(groupByDay([], now, true)).toEqual([]);
  });
});
