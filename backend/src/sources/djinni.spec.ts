import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDjinniSource } from './djinni';

const html = readFileSync(join(__dirname, '../../test/fixtures/djinni-list.html'), 'utf8');

describe('djinni source', () => {
  it('extracts postings with absolute urls and stable ids', async () => {
    const src = createDjinniSource(
      'https://djinni.co/jobs/keyword-node/',
      async () => new Response(html, { status: 200 }),
    );
    const out = await src.listPostings();
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(p.source).toBe('djinni');
      expect(p.id.startsWith('djinni:')).toBe(true);
      expect(p.url.startsWith('https://djinni.co/')).toBe(true);
      expect(p.title.length).toBeGreaterThan(0);
    }
  });

  it('throws with the source id on a non-ok response', async () => {
    const src = createDjinniSource(
      'https://djinni.co/jobs/keyword-node/',
      async () => new Response('', { status: 500 }),
    );
    await expect(src.listPostings()).rejects.toThrow(/djinni.*500/);
  });
});
