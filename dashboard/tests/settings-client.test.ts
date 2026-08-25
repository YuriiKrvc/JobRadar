import { describe, expect, it, vi } from 'vitest';
import {
  addSource, deleteSource, fetchSettings, fetchSources,
  saveCv, saveProfile, saveRubric, toggleSource,
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
    expect((await addSource({ kind: 'dou', url: 'https://x.co/' }, f)).id).toBe('new');
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
    await expect(addSource({ kind: 'dou', url: 'https://x.co/' }, f))
      .rejects.toThrow('That source is already configured');
  });
});
