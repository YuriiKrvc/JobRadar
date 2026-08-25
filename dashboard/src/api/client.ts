import type { HealthRow, PostingFilters, PostingRow } from './types';

async function getJson<T>(url: string, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(url);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // Non-JSON error body (proxy error page, etc.) — keep the status text.
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

function toQuery(filters: PostingFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchPostings(
  filters: PostingFilters = {},
  fetchFn: typeof fetch = fetch,
): Promise<PostingRow[]> {
  const body = await getJson<{ postings: PostingRow[] }>(
    `/api/postings${toQuery(filters)}`, fetchFn,
  );
  return body.postings;
}

export async function fetchHealth(fetchFn: typeof fetch = fetch): Promise<HealthRow[]> {
  const body = await getJson<{ sources: HealthRow[] }>('/api/health', fetchFn);
  return body.sources;
}
