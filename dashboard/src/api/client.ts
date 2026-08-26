import type { HealthRow, PostingFilters, PostingRow } from './types';

export async function getJson<T>(url: string, fetchFn: typeof fetch = fetch): Promise<T> {
  return request<T>(url, {}, fetchFn);
}

export async function sendJson<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  return request<T>(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, fetchFn);
}

async function request<T>(url: string, init: RequestInit, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(url, init);

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      // NestJS sends {statusCode, error, message}; `message` carries the Zod
      // issues, `error` is only the generic status name.
      const body = await res.json() as { message?: string | string[]; error?: string };
      const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
      if (message) detail = message;
      else if (body.error) detail = body.error;
    } catch {
      // Non-JSON error body (proxy error page, etc.) — keep the status text.
    }
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
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
