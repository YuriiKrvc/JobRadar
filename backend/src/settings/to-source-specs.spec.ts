import { toSourceSpecs } from './to-source-specs';
import type { SourceRow } from './to-source-specs';

function row(over: Partial<SourceRow> = {}): SourceRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Acme',
    url: 'https://acme.com/careers',
    selectors: { item: 'li', link: 'a' },
    blockedTitleWords: [],
    blockedDescriptionWords: [],
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  } as SourceRow;
}

describe('toSourceSpecs', () => {
  it('drops disabled rows so callers never have to filter', () => {
    const out = toSourceSpecs([row(), row({ id: 'b', name: 'B', url: 'u', enabled: false })]);
    expect(out.map((s) => s.name)).toEqual(['Acme']);
  });

  it('carries the id, selectors and per-source word lists through', () => {
    const out = toSourceSpecs([row({ blockedTitleWords: ['intern'], blockedDescriptionWords: ['onsite'] })]);
    expect(out[0]).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Acme',
      url: 'https://acme.com/careers',
      selectors: { item: 'li', link: 'a' },
      blockedTitleWords: ['intern'],
      blockedDescriptionWords: ['onsite'],
    });
  });

  it('returns an empty list for no rows', () => {
    expect(toSourceSpecs([])).toEqual([]);
  });
});
