import { describe, it, expect } from 'vitest';
import { fetchPostings, fetchHealth } from '../src/api/client';

const posting = {
  postingId: 'x:1', title: 'T', company: 'C', url: 'u', source: 'djinni',
  location: null, total: 80, verdict: 'STRONG', reasoning: 'r',
  providerId: 'p', scoredAt: '2026-08-25T10:00:00.000Z',
};

function stub(body: unknown, status = 200) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fn: fn as unknown as typeof fetch };
}

describe('api client', () => {
  it('requests /api/postings and unwraps the array', async () => {
    const { calls, fn } = stub({ postings: [posting] });
    const rows = await fetchPostings({}, fn);
    expect(calls[0]).toBe('/api/postings');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verdict).toBe('STRONG');
  });

  it('serialises filters into the query string and omits empty ones', async () => {
    const { calls, fn } = stub({ postings: [] });
    await fetchPostings({ verdict: 'MAYBE', source: '', minTotal: 40 }, fn);
    expect(calls[0]).toBe('/api/postings?verdict=MAYBE&minTotal=40');
  });

  it('throws the server error message on a 400', async () => {
    const { fn } = stub({ error: 'verdict: invalid' }, 400);
    await expect(fetchPostings({}, fn)).rejects.toThrow(/verdict: invalid/);
  });

  it('throws a generic message when the body is not JSON', async () => {
    const fn = (async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(fetchPostings({}, fn)).rejects.toThrow(/502/);
  });

  it('requests /api/health and unwraps sources', async () => {
    const { calls, fn } = stub({ sources: [{ source: 'dou', status: 'ok', ranAt: 'x', error: null }] });
    const rows = await fetchHealth(fn);
    expect(calls[0]).toBe('/api/health');
    expect(rows[0]!.source).toBe('dou');
  });
});

function failing(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

describe('error detail', () => {
  it('reads NestJS message, not error', async () => {
    const f = failing(400, {
      statusCode: 400, error: 'Bad Request', message: 'profile.minSalaryUsd: must be positive',
    });
    await expect(fetchPostings({}, f)).rejects.toThrow('profile.minSalaryUsd: must be positive');
  });

  it('falls back to error when message is absent', async () => {
    const f = failing(409, { statusCode: 409, error: 'Conflict' });
    await expect(fetchPostings({}, f)).rejects.toThrow('Conflict');
  });

  it('falls back to the status when the body is not JSON', async () => {
    const f = (async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(fetchPostings({}, f)).rejects.toThrow('HTTP 502');
  });
});
