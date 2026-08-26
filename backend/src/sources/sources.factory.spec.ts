import { buildSource } from './sources.factory';
import type { SourceSpec } from '../settings/schema';

function spec(over: Partial<SourceSpec> = {}): SourceSpec {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Acme',
    url: 'https://acme.com/careers',
    selectors: { item: 'li.job', link: 'a' },
    blockedTitleWords: [],
    blockedDescriptionWords: [],
    ...over,
  };
}

describe('buildSource', () => {
  it('names the adapter after the spec, because that is what run_log records', () => {
    expect(buildSource(spec({ name: 'Beta Boards' })).id).toBe('Beta Boards');
  });

  it('exposes hydrate, the second fetch the pipeline needs for descriptions', () => {
    expect(typeof buildSource(spec()).hydrate).toBe('function');
  });

  // Not just shape: the spec's url and selectors must actually reach the
  // adapter, which a stub returning `{ id }` would pass without doing.
  it('fetches the spec url and parses postings with the spec selectors', async () => {
    const fetchMock = jest.fn(async () => new Response(
      '<ul><li class="job"><a href="/jobs/1">Node Engineer</a></li></ul>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ));
    const original = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      const postings = await buildSource(spec()).listPostings();
      expect(fetchMock).toHaveBeenCalledWith('https://acme.com/careers');
      expect(postings).toHaveLength(1);
      expect(postings[0]!.source).toBe('Acme');
      expect(postings[0]!.title).toBe('Node Engineer');
      expect(postings[0]!.url).toBe('https://acme.com/jobs/1');
    } finally {
      global.fetch = original;
    }
  });
});
