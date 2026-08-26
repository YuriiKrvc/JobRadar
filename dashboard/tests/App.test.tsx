import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App';
import type { HealthRow, PostingRow } from '../src/api/types';

const DIM = { score: 0, note: 'n' };
const SUBSCORES = {
  coreStack: DIM, seniority: DIM, domain: DIM, logistics: DIM, growth: DIM,
};

const posting = {
  postingId: 'x:1', title: 'Senior Node Engineer', company: 'Acme',
  url: 'https://e.com/1', source: 'djinni', location: 'Remote',
  total: 82, verdict: 'STRONG', reasoning: 'r', providerId: 'p',
  scoredAt: '2026-08-25T10:00:00.000Z', settingsVersion: '1', subscores: SUBSCORES,
};

const SETTINGS_STUB = {
  cv: '', rubricBody: '', rubricWeights: {
    coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10,
  },
  profile: {
    excludedLocations: [], allowedEmploymentTypes: [], minSalaryUsd: null, timezone: 'Europe/Kyiv',
    blockedTitleWords: [], blockedDescriptionWords: [],
  },
  version: 1, updatedAt: '2026-08-25T10:00:00.000Z',
};

function mockFetch(handler: (url: string) => { body: unknown; status?: number }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const { body, status = 200 } = handler(String(input));
    return new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
  });
}

/**
 * Stubs global fetch for /api/postings, /api/health, /api/settings and
 * /api/sources. Defaults match what the pre-refactor inline stub always
 * returned for the routes a given test did not care about: one posting row,
 * an empty health list, the shared SETTINGS_STUB, and no sources.
 */
function stubFetch({
  health = [] as HealthRow[],
  postings = [posting] as PostingRow[],
}: { health?: HealthRow[]; postings?: PostingRow[] } = {}) {
  const fetchMock = mockFetch((url) => {
    if (url.startsWith('/api/postings')) return { body: { postings } };
    if (url.startsWith('/api/health')) return { body: { sources: health } };
    if (url.startsWith('/api/settings')) return { body: SETTINGS_STUB };
    if (url.startsWith('/api/sources')) return { body: { sources: [] } };
    return { body: { sources: [] } };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('App', () => {
  it('shows a loading state, then the table', async () => {
    stubFetch();
    renderAt('/');
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Senior Node Engineer')).toBeInTheDocument());
  });

  it('shows the server error message when the API fails', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ body: { error: 'db exploded' }, status: 500 })));
    renderAt('/');
    await waitFor(() => expect(screen.getByText(/db exploded/)).toBeInTheDocument());
  });

  it('refetches with a verdict filter in the query string', async () => {
    const fetchMock = stubFetch();
    renderAt('/');
    await waitFor(() => expect(screen.getByText('Senior Node Engineer')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^strong$/i }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('verdict=STRONG'))).toBe(true);
    });
  });

  it('renders the source health panel', async () => {
    stubFetch({
      health: [{ source: 'djinni', status: 'error', ranAt: '2026-08-25T10:00:00.000Z', error: 'selector miss' }],
    });
    renderAt('/');
    await waitFor(() => expect(screen.getByText(/selector miss/)).toBeInTheDocument());
  });
});

describe('routing', () => {
  beforeEach(() => { stubFetch(); });

  it('renders postings at the root path', async () => {
    renderAt('/');
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByText('Senior Node Engineer')).toBeInTheDocument());
  });

  it('renders settings at /settings without a click', async () => {
    renderAt('/settings');
    expect(screen.getByRole('tab', { name: /settings/i })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: /save rubric/i })).toBeInTheDocument());
  });

  it('navigates between the two routes', async () => {
    renderAt('/');
    await userEvent.click(screen.getByRole('tab', { name: /settings/i }));
    expect(screen.getByRole('tab', { name: /settings/i })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: /postings/i }));
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('redirects an unknown path to postings', async () => {
    renderAt('/nowhere');
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('applies a filter taken from the initial query string', async () => {
    const fetchMock = stubFetch();
    renderAt('/?verdict=MAYBE');

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('verdict=MAYBE'))).toBe(true);
    });
  });
});

describe('first-run banner', () => {
  it('prompts setup when health reports incomplete settings', async () => {
    stubFetch({
      health: [{
        source: 'settings', status: 'error',
        ranAt: '2026-08-25T10:00:00.000Z', error: 'settings incomplete: no CV',
      }],
    });
    renderAt('/');
    expect(await screen.findByRole('alert')).toHaveTextContent(/finish setup/i);
  });

  it('links the banner to the settings tab', async () => {
    stubFetch({
      health: [{
        source: 'settings', status: 'error',
        ranAt: '2026-08-25T10:00:00.000Z', error: 'settings incomplete: no enabled sources',
      }],
    });
    renderAt('/');

    expect(await screen.findByRole('link', { name: /finish setup/i }))
      .toHaveAttribute('href', '/settings');
  });

  it('shows no banner when settings are complete', async () => {
    stubFetch({ health: [{ source: 'ats', status: 'ok', ranAt: '2026-08-25T10:00:00.000Z', error: null }] });
    renderAt('/');
    await screen.findByRole('tab', { name: /postings/i });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('settings load failure banner', () => {
  // A settings READ failure (unseeded or degraded database) logs a `settings`
  // error row whose message is not "settings incomplete". Before the fix the
  // banner matched only that literal, so the one useful message was visible
  // solely in `docker logs`.
  it('banners a settings read failure, not just an incomplete config', async () => {
    stubFetch({
      health: [{
        source: 'settings', status: 'error', ranAt: '2026-08-25T10:00:00.000Z',
        error: 'app_settings is empty — run the seeder',
      }],
    });
    renderAt('/');

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/run the seeder/i);
    expect(banner).toHaveTextContent(/finish setup/i);
  });

  it('ignores a settings row that is not an error', async () => {
    stubFetch({
      health: [{ source: 'settings', status: 'ok', ranAt: '2026-08-25T10:00:00.000Z', error: null }],
    });
    renderAt('/');
    await screen.findByRole('tab', { name: /postings/i });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/**
 * App owns the settings fetch so a save in the Settings tab is reflected by the
 * Postings tab's stale badge. Held separately in SettingsPage, `currentVersion`
 * stayed at its mount-time value and nothing was ever badged until F5.
 */
describe('stale badge after a save in Settings', () => {
  it('reflects the new settings version without a page reload', async () => {
    let version = 1;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = (() => {
        if (url.startsWith('/api/postings')) return { postings: [posting] };
        if (url.startsWith('/api/health')) return { sources: [] };
        if (url.startsWith('/api/sources')) return { sources: [] };
        if (url === '/api/settings/rubric' && init?.method === 'PUT') {
          version = 2;
          return { version };
        }
        return { ...SETTINGS_STUB, version };
      })();
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAt('/');
    // The posting is scored under version 1 and current is 1: no badge.
    await screen.findByText('Senior Node Engineer');
    expect(screen.queryByRole('img', { name: /stale/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /settings/i }));
    const growth = await screen.findByLabelText('growth');
    await userEvent.clear(growth);
    await userEvent.type(growth, '99');
    await userEvent.click(screen.getByRole('button', { name: /save rubric/i }));
    await waitFor(() => expect(screen.getByText(/version 2/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole('tab', { name: /postings/i }));
    expect(await screen.findByRole('img', { name: /stale/i })).toBeInTheDocument();
  });
});

