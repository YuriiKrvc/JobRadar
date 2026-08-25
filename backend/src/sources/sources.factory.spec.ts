import { buildSources } from './sources.factory';

describe('buildSources', () => {
  it('creates one source per configured entry, in a stable order', () => {
    const sources = buildSources({
      ats: [{ board: 'greenhouse', slug: 'acme' }, { board: 'lever', slug: 'beta' }],
      djinni: ['https://djinni.co/jobs/keyword-node/'],
      dou: ['https://jobs.dou.ua/vacancies/'],
    });
    expect(sources.map((s) => s.id)).toEqual(['greenhouse:acme', 'lever:beta', 'djinni', 'dou']);
  });

  it('returns an empty list when nothing is configured', () => {
    expect(buildSources({ ats: [], djinni: [], dou: [] })).toEqual([]);
  });
});
