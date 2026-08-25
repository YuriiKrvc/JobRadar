import { describe, it, expect } from 'vitest';
import { createDjinniSource } from '../../src/sources/djinni';
import { createDouSource } from '../../src/sources/dou';
import { createAtsSource } from '../../src/sources/ats';

// Run with: INTEGRATION=1 npm run test:integration
describe.skipIf(!process.env.INTEGRATION)('live sources', () => {
  it('djinni still yields postings with the expected selectors', async () => {
    const out = await createDjinniSource('https://djinni.co/jobs/keyword-node/').listPostings();
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.title.length).toBeGreaterThan(0);
    expect(out[0]!.url).toMatch(/^https:\/\/djinni\.co\//);
  }, 30_000);

  it('dou still yields postings with the expected selectors', async () => {
    const out = await createDouSource('https://jobs.dou.ua/vacancies/?category=Node.js').listPostings();
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.company.length).toBeGreaterThan(0);
  }, 30_000);

  it('a public greenhouse board still parses', async () => {
    const out = await createAtsSource({ board: 'greenhouse', slug: 'anthropic' }).listPostings();
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.id).toMatch(/^greenhouse:anthropic:/);
  }, 30_000);
});
