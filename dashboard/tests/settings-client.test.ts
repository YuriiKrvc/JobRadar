import { describe, expect, it, vi } from 'vitest';
import {
  addSource, deleteSource, fetchSettings, fetchSources,
  saveCv, saveProfile, saveRubric, toggleSource, updateSource,
} from '../src/api/settings';

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };

function ok(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

describe('settings client', () => {
  it('fetches settings', async () => {
    const f = ok({ cv: 'c', rubricBody: 'r', rubricWeights: WEIGHTS, profile: {}, version: 2, updatedAt: 'x' });
    expect((await fetchSettings(f)).version).toBe(2);
    expect(f).toHaveBeenCalledWith('/api/settings', expect.anything());
  });

  it('fills in profile list fields the server omitted', async () => {
    // A server predating the profile-parse fix returns a v1-shaped blob with no
    // blocked-word keys at all. Passing that through hands `undefined` to
    // ChipInput's value.map(), which throws during render and unmounts the whole
    // dashboard — including the Settings page that is the only way to fix it.
    const f = ok({
      cv: 'c', rubricBody: 'r', rubricWeights: WEIGHTS, version: 2, updatedAt: 'x',
      profile: {
        excludedLocations: ['Kyiv'], allowedEmploymentTypes: ['full-time'],
        minSalaryUsd: null, timezone: 'Europe/Kyiv',
      },
    });

    const { profile } = await fetchSettings(f);

    expect(profile.blockedTitleWords).toEqual([]);
    expect(profile.blockedDescriptionWords).toEqual([]);
    // What the server did send is untouched.
    expect(profile.excludedLocations).toEqual(['Kyiv']);
    expect(profile.allowedEmploymentTypes).toEqual(['full-time']);
    expect(profile.timezone).toBe('Europe/Kyiv');
  });

  it('leaves a complete profile exactly as the server sent it', async () => {
    const f = ok({
      cv: 'c', rubricBody: 'r', rubricWeights: WEIGHTS, version: 2, updatedAt: 'x',
      profile: {
        excludedLocations: [], allowedEmploymentTypes: [], minSalaryUsd: 70000,
        timezone: 'Europe/Kyiv', blockedTitleWords: ['php'], blockedDescriptionWords: ['on-site'],
      },
    });

    const { profile } = await fetchSettings(f);

    expect(profile.blockedTitleWords).toEqual(['php']);
    expect(profile.blockedDescriptionWords).toEqual(['on-site']);
    expect(profile.minSalaryUsd).toBe(70000);
  });

  it('PUTs the cv and returns the new version', async () => {
    const f = ok({ version: 5 });
    expect(await saveCv('new cv', f)).toBe(5);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/settings/cv');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ cv: 'new cv' });
  });

  it('PUTs rubric body and weights together', async () => {
    const f = ok({ version: 6 });
    expect(await saveRubric('body', WEIGHTS, f)).toBe(6);
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({ body: 'body', weights: WEIGHTS });
  });

  it('PUTs the profile as the bare object', async () => {
    const f = ok({ version: 7 });
    const profile = {
      excludedLocations: ['US'], allowedEmploymentTypes: [], minSalaryUsd: null, timezone: 'Europe/Kyiv',
      blockedTitleWords: [], blockedDescriptionWords: [],
    };
    expect(await saveProfile(profile, f)).toBe(7);
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual(profile);
  });

  it('unwraps the sources list', async () => {
    const f = ok({ sources: [{ id: 'a' }, { id: 'b' }] });
    expect(await fetchSources(f)).toHaveLength(2);
  });

  it('POSTs a new source and unwraps it', async () => {
    const f = ok({ source: { id: 'new' } });
    const input = {
      name: 'DOU', url: 'https://x.co/',
      selectors: { item: 'li', link: 'a' },
      blockedTitleWords: [], blockedDescriptionWords: [],
    };
    expect((await addSource(input, f)).id).toBe('new');
  });

  it('PATCHes the toggle', async () => {
    const f = ok({ source: { id: 'a', enabled: false } });
    expect((await toggleSource('a', false, f)).enabled).toBe(false);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/sources/a');
    expect(init.method).toBe('PATCH');
  });

  it('DELETEs and tolerates a 204 with no body', async () => {
    const f = ok(null, 204);
    await expect(deleteSource('a', f)).resolves.toBeUndefined();
  });

  it('surfaces a 409 message from addSource', async () => {
    const f = (async () => new Response(
      JSON.stringify({ statusCode: 409, message: 'That source is already configured' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;
    const input = {
      name: 'DOU', url: 'https://x.co/',
      selectors: { item: 'li', link: 'a' },
      blockedTitleWords: [], blockedDescriptionWords: [],
    };
    await expect(addSource(input, f))
      .rejects.toThrow('That source is already configured');
  });

  it('PUTs a replaced source and returns the row', async () => {
    const input = {
      name: 'Acme', url: 'https://acme.com/careers',
      selectors: { item: 'li', link: 'a' },
      blockedTitleWords: [], blockedDescriptionWords: [],
    };
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ source: { id: 'u1', ...input, enabled: true, createdAt: 'now' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    const row = await updateSource('u1', input, fetchFn as unknown as typeof fetch);

    expect(fetchFn).toHaveBeenCalledWith('/api/sources/u1', expect.objectContaining({ method: 'PUT' }));
    expect(row.id).toBe('u1');
  });
});
