import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDouSource } from './dou';

const html = readFileSync(join(__dirname, '../../test/fixtures/dou-list.html'), 'utf8');

describe('dou source', () => {
  it('extracts postings with stable ids', async () => {
    const src = createDouSource(
      'https://jobs.dou.ua/vacancies/?category=Node.js',
      async () => new Response(html, { status: 200 }),
    );
    const out = await src.listPostings();
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(p.source).toBe('dou');
      expect(p.id.startsWith('dou:')).toBe(true);
      expect(p.company.length).toBeGreaterThan(0);
    }
  });

  it('throws with the source id on a non-ok response', async () => {
    const src = createDouSource('https://jobs.dou.ua/vacancies/', async () => new Response('', { status: 502 }));
    await expect(src.listPostings()).rejects.toThrow(/dou.*502/);
  });
});
