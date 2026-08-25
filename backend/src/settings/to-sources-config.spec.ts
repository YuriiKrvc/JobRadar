import { toSourcesConfig, type SourceRow } from './to-sources-config';

function row(over: Partial<SourceRow>): SourceRow {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    kind: 'ats', board: null, slug: null, url: null,
    enabled: true, createdAt: new Date(),
    ...over,
  } as SourceRow;
}

describe('toSourcesConfig', () => {
  it('groups ats rows into board/slug pairs', () => {
    const cfg = toSourcesConfig([
      row({ kind: 'ats', board: 'greenhouse', slug: 'acme' }),
      row({ kind: 'ats', board: 'lever', slug: 'globex' }),
    ]);
    expect(cfg.ats).toEqual([
      { board: 'greenhouse', slug: 'acme' },
      { board: 'lever', slug: 'globex' },
    ]);
    expect(cfg.djinni).toEqual([]);
    expect(cfg.dou).toEqual([]);
  });

  it('collects djinni and dou rows as bare urls', () => {
    const cfg = toSourcesConfig([
      row({ kind: 'djinni', url: 'https://djinni.co/jobs/a/' }),
      row({ kind: 'dou', url: 'https://jobs.dou.ua/vacancies/feeds/?category=Node.js' }),
    ]);
    expect(cfg.djinni).toEqual(['https://djinni.co/jobs/a/']);
    expect(cfg.dou).toEqual(['https://jobs.dou.ua/vacancies/feeds/?category=Node.js']);
  });

  it('drops disabled rows', () => {
    const cfg = toSourcesConfig([
      row({ kind: 'ats', board: 'greenhouse', slug: 'live' }),
      row({ kind: 'ats', board: 'greenhouse', slug: 'paused', enabled: false }),
      row({ kind: 'djinni', url: 'https://djinni.co/jobs/off/', enabled: false }),
    ]);
    expect(cfg.ats).toEqual([{ board: 'greenhouse', slug: 'live' }]);
    expect(cfg.djinni).toEqual([]);
  });

  it('returns empty groups for no rows', () => {
    expect(toSourcesConfig([])).toEqual({ ats: [], djinni: [], dou: [] });
  });

  it('produces a value SourcesSchema accepts', () => {
    const { SourcesSchema } = require('./schema') as typeof import('./schema');
    const cfg = toSourcesConfig([row({ kind: 'ats', board: 'ashby', slug: 'acme' })]);
    expect(() => SourcesSchema.parse(cfg)).not.toThrow();
  });
});
