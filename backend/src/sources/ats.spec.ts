import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAtsSource } from './ats';


function fixtureFetch(file: string) {
  const body = readFileSync(join(__dirname, '../../test/fixtures', file), 'utf8');
  return async () => new Response(body, { status: 200 });
}

describe('ats source', () => {
  it('maps a greenhouse board to RawPostings', async () => {
    const src = createAtsSource({ board: 'greenhouse', slug: 'acme' }, fixtureFetch('greenhouse-acme.json'));
    const out = await src.listPostings();
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('greenhouse:acme:4001');
    expect(out[0]!.title).toBe('Senior Backend Engineer');
    expect(out[0]!.location).toBe('Remote - Europe');
    expect(out[0]!.description).toContain('Node engineer');
    expect(out[0]!.description).not.toContain('<p>');
  });

  it('throws with the board name when the response is not ok', async () => {
    const src = createAtsSource(
      { board: 'greenhouse', slug: 'acme' },
      async () => new Response('nope', { status: 503 }),
    );
    await expect(src.listPostings()).rejects.toThrow(/greenhouse:acme.*503/);
  });

  it('maps a lever board to RawPostings', async () => {
    const src = createAtsSource({ board: 'lever', slug: 'acme' }, fixtureFetch('lever-acme.json'));
    const out = await src.listPostings();
    expect(out[0]!.id).toMatch(/^lever:acme:/);
    expect(out[0]!.employmentType).toBeTruthy();
  });

  it('maps an ashby board to RawPostings', async () => {
    const src = createAtsSource({ board: 'ashby', slug: 'acme' }, fixtureFetch('ashby-acme.json'));
    const out = await src.listPostings();
    expect(out[0]!.id).toMatch(/^ashby:acme:/);
  });
});
