import { getJson, sendJson } from './client';
import type {
  ProfileInput, RubricWeights, SettingsResponse, SourceInput, SourceRow,
} from './types';

export function fetchSettings(fetchFn: typeof fetch = fetch): Promise<SettingsResponse> {
  return getJson<SettingsResponse>('/api/settings', fetchFn);
}

export async function saveCv(cv: string, fetchFn: typeof fetch = fetch): Promise<number> {
  const { version } = await sendJson<{ version: number }>('PUT', '/api/settings/cv', { cv }, fetchFn);
  return version;
}

export async function saveRubric(
  body: string, weights: RubricWeights, fetchFn: typeof fetch = fetch,
): Promise<number> {
  const res = await sendJson<{ version: number }>(
    'PUT', '/api/settings/rubric', { body, weights }, fetchFn,
  );
  return res.version;
}

export async function saveProfile(
  profile: ProfileInput, fetchFn: typeof fetch = fetch,
): Promise<number> {
  const res = await sendJson<{ version: number }>('PUT', '/api/settings/profile', profile, fetchFn);
  return res.version;
}

export async function fetchSources(fetchFn: typeof fetch = fetch): Promise<SourceRow[]> {
  const { sources } = await getJson<{ sources: SourceRow[] }>('/api/sources', fetchFn);
  return sources;
}

export async function addSource(
  input: SourceInput, fetchFn: typeof fetch = fetch,
): Promise<SourceRow> {
  const { source } = await sendJson<{ source: SourceRow }>('POST', '/api/sources', input, fetchFn);
  return source;
}

export async function toggleSource(
  id: string, enabled: boolean, fetchFn: typeof fetch = fetch,
): Promise<SourceRow> {
  const { source } = await sendJson<{ source: SourceRow }>(
    'PATCH', `/api/sources/${id}`, { enabled }, fetchFn,
  );
  return source;
}

export async function deleteSource(id: string, fetchFn: typeof fetch = fetch): Promise<void> {
  await sendJson<void>('DELETE', `/api/sources/${id}`, undefined, fetchFn);
}
