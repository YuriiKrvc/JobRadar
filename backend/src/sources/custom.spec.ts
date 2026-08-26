import { createCustomSource, externalIdFrom } from './custom';
import type { SourceSpec } from '../settings/schema';

const LISTING = `
<html><body>
  <ul>
    <li class="opening">
      <a class="t" href="/careers/123-senior-node">Senior Node Developer</a>
      <span class="loc">Remote, EU</span>
      <span class="type">Full-time</span>
      <p class="snip">Node, Postgres, $90,000</p>
    </li>
    <li class="opening">
      <a class="t" href="https://acme.com/careers/124-qa">QA Engineer</a>
      <span class="loc">Kyiv</span>
    </li>
    <li class="opening"><span>section header with no link</span></li>
    <li class="opening"><a class="t" href="/careers/125"></a></li>
  </ul>
</body></html>`;

const DETAIL = `
<html><body>
  <nav>site navigation</nav>
  <div class="jd">  We need a  Node engineer.
  Salary $120,000. </div>
</body></html>`;

function spec(over: Partial<SourceSpec> = {}): SourceSpec {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Acme',
    url: 'https://acme.com/careers',
    selectors: {
      item: 'li.opening', link: 'a.t', location: 'span.loc',
      employmentType: 'span.type', description: 'p.snip',
    },
    blockedTitleWords: [],
    blockedDescriptionWords: [],
    ...over,
  };
}

function fetchOk(body: string) {
  return async () => ({ ok: true, status: 200, text: async () => body } as unknown as Response);
}

describe('createCustomSource.listPostings', () => {
  it('uses the source name as the adapter id, so run_log names the board', () => {
    expect(createCustomSource(spec(), fetchOk(LISTING)).id).toBe('Acme');
  });

  it('extracts one posting per item selector match', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out).toHaveLength(2);
  });

  it('resolves a relative href against the listing URL', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[0]!.url).toBe('https://acme.com/careers/123-senior-node');
  });

  it('leaves an absolute href alone', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[1]!.url).toBe('https://acme.com/careers/124-qa');
  });

  it('keys the posting id on the source uuid, not its name', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[0]!.id).toBe('src:11111111-1111-1111-1111-111111111111:/careers/123-senior-node');
  });

  it('takes the title from the link text when no title selector is given', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[0]!.title).toBe('Senior Node Developer');
  });

  it('falls back to the source name for company', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[0]!.company).toBe('Acme');
  });

  it('reads the optional selectors when present and nulls them when absent', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[0]!.location).toBe('Remote, EU');
    expect(out[0]!.employmentType).toBe('Full-time');
    expect(out[0]!.description).toBe('Node, Postgres, $90,000');
    expect(out[1]!.location).toBe('Kyiv');
    expect(out[1]!.employmentType).toBeNull();
    expect(out[1]!.description).toBe('');
  });

  it('skips items with no link and items with an empty title', async () => {
    // The third and fourth <li> match `item` but are not postings. A listing
    // page almost always has one or two of these.
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out.map((p) => p.title)).toEqual(['Senior Node Developer', 'QA Engineer']);
  });

  it('names the source and URL when the listing request fails', async () => {
    const bad = async () => ({ ok: false, status: 503, text: async () => '' } as unknown as Response);
    await expect(createCustomSource(spec(), bad).listPostings())
      .rejects.toThrow('Acme returned HTTP 503 for https://acme.com/careers');
  });
});

describe('externalIdFrom', () => {
  it('uses the pathname with any trailing slash removed', () => {
    expect(externalIdFrom('https://acme.com/careers/123-node/')).toBe('/careers/123-node');
  });

  it('keeps the query string, because some boards put the id there', () => {
    expect(externalIdFrom('https://acme.com/job?id=42')).toBe('/job?id=42');
  });
});

describe('createCustomSource.hydrate', () => {
  const listed = {
    id: 'src:x:1', source: 'Acme', externalId: '1', url: 'https://acme.com/careers/123',
    title: 'T', company: 'Acme', location: null, employmentType: null,
    description: 'listing snippet', raw: {},
  };

  it('replaces the description with the detail selector text', async () => {
    const s = createCustomSource(spec({ selectors: { ...spec().selectors, detail: 'div.jd' } }), fetchOk(DETAIL));
    const out = await s.hydrate!(listed);
    expect(out.description).toBe('We need a Node engineer. Salary $120,000.');
  });

  it('uses the whole page text when no detail selector is given', async () => {
    const out = await createCustomSource(spec(), fetchOk(DETAIL)).hydrate!(listed);
    expect(out.description).toContain('site navigation');
    expect(out.description).toContain('Node engineer');
  });

  it('keeps the listing snippet when the detail selector matches nothing', async () => {
    const s = createCustomSource(spec({ selectors: { ...spec().selectors, detail: 'div.missing' } }), fetchOk(DETAIL));
    expect((await s.hydrate!(listed)).description).toBe('listing snippet');
  });

  it('leaves every other field untouched', async () => {
    const out = await createCustomSource(spec(), fetchOk(DETAIL)).hydrate!(listed);
    expect({ ...out, description: listed.description }).toEqual(listed);
  });

  it('throws naming the posting URL when the detail request fails', async () => {
    const bad = async () => ({ ok: false, status: 404, text: async () => '' } as unknown as Response);
    await expect(createCustomSource(spec(), bad).hydrate!(listed))
      .rejects.toThrow('Acme detail returned HTTP 404 for https://acme.com/careers/123');
  });
});
