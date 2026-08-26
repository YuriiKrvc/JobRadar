import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, formatLastRun } from '../src/App';
import type { HealthRow, PostingRow } from '../src/api/types';

const posting = {
  postingId: 'x:1', title: 'Senior Node Engineer', company: 'Acme',
  url: 'https://e.com/1', source: 'djinni', location: 'Remote',
  total: 82, verdict: 'STRONG', reasoning: 'r', providerId: 'p',
  scoredAt: '2026-08-25T10:00:00.000Z', settingsVersion: '1',
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

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('App', () => {
  it('shows a loading state, then the table', async () => {
    stubFetch();
    render(<App />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Senior Node Engineer')).toBeInTheDocument());
  });

  it('shows the server error message when the API fails', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ body: { error: 'db exploded' }, status: 500 })));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/db exploded/)).toBeInTheDocument());
  });

  it('refetches with a verdict filter in the query string', async () => {
    const fetchMock = stubFetch();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Senior Node Engineer')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText(/verdict/i), 'MAYBE');
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('verdict=MAYBE'))).toBe(true);
    });
  });

  it('renders the source health panel', async () => {
    stubFetch({
      health: [{ source: 'djinni', status: 'error', ranAt: '2026-08-25T10:00:00.000Z', error: 'selector miss' }],
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/selector miss/)).toBeInTheDocument());
  });

  it('mastheads the product and its promise', async () => {
    stubFetch();
    render(<App />);
    expect(screen.getByText('JobRadar')).toBeInTheDocument();
    expect(screen.getByText('Stop scrolling job boards. Read the shortlist.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Senior Node Engineer')).toBeInTheDocument());
  });

  it('shows the settings version and the last run in the meta strip', async () => {
    stubFetch({ health: [{ source: 'djinni', status: 'ok', ranAt: '2026-08-26T08:30:00.000Z', error: null }] });
    render(<App />);
    expect(await screen.findByText(/Scoring settings v1/)).toBeInTheDocument();
    expect(screen.getByText(/1 posting scored/)).toBeInTheDocument();
  });

  it('reads "never" when nothing has run yet', async () => {
    stubFetch({ health: [], postings: [] });
    render(<App />);
    expect(await screen.findByText(/Last run never/)).toBeInTheDocument();
  });

  it('reads a recent run and a stale run visibly differently', async () => {
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
    stubFetch({ health: [{ source: 'djinni', status: 'ok', ranAt: '2026-08-26T11:30:00.000Z', error: null }] });
    render(<App />);
    expect(await screen.findByText(/Last run 30m ago/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('reads a run from several days ago in days, not a bare time', async () => {
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
    stubFetch({ health: [{ source: 'djinni', status: 'ok', ranAt: '2026-08-20T12:00:00.000Z', error: null }] });
    render(<App />);
    expect(await screen.findByText(/Last run 6 days ago/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('picks the newest of several health rows regardless of their order', async () => {
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
    stubFetch({
      health: [
        { source: 'a', status: 'ok', ranAt: '2026-08-24T10:00:00.000Z', error: null },
        { source: 'c', status: 'ok', ranAt: '2026-08-26T10:00:00.000Z', error: null },
        { source: 'b', status: 'ok', ranAt: '2026-08-25T10:00:00.000Z', error: null },
      ],
    });
    render(<App />);
    // Newest is 2026-08-26T10:00:00.000Z — two hours before the frozen clock.
    expect(await screen.findByText(/Last run 2h ago/)).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe('formatLastRun', () => {
  it('reads minutes within the first hour', () => {
    expect(formatLastRun('2026-08-26T11:45:00.000Z', new Date('2026-08-26T12:00:00.000Z'))).toBe('15m ago');
  });

  it('reads hours within the same day', () => {
    expect(formatLastRun('2026-08-26T06:00:00.000Z', new Date('2026-08-26T12:00:00.000Z'))).toBe('6h ago');
  });

  it('reads days for anything a day or older', () => {
    expect(formatLastRun('2026-08-20T12:00:00.000Z', new Date('2026-08-26T12:00:00.000Z'))).toBe('6 days ago');
  });

  it('singularises exactly one day', () => {
    expect(formatLastRun('2026-08-25T11:00:00.000Z', new Date('2026-08-26T12:00:00.000Z'))).toBe('1 day ago');
  });
});

describe('tab navigation', () => {
  beforeEach(() => {
    stubFetch();
  });

  it('shows postings first', async () => {
    render(<App />);
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to settings and back', async () => {
    render(<App />);

    await userEvent.click(screen.getByRole('tab', { name: /settings/i }));
    expect(screen.getByRole('tab', { name: /settings/i })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: /postings/i }));
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
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
    render(<App />);
    expect(await screen.findByRole('status')).toHaveTextContent(/finish setup/i);
  });

  it('links the banner to the settings tab', async () => {
    stubFetch({
      health: [{
        source: 'settings', status: 'error',
        ranAt: '2026-08-25T10:00:00.000Z', error: 'settings incomplete: no enabled sources',
      }],
    });
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: /finish setup/i }));
    expect(screen.getByRole('tab', { name: /settings/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows no banner when settings are complete', async () => {
    stubFetch({ health: [{ source: 'ats', status: 'ok', ranAt: '2026-08-25T10:00:00.000Z', error: null }] });
    render(<App />);
    await screen.findByRole('tab', { name: /postings/i });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
    render(<App />);

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(/run the seeder/i);
    expect(banner).toHaveTextContent(/finish setup/i);
  });

  it('ignores a settings row that is not an error', async () => {
    stubFetch({
      health: [{ source: 'settings', status: 'ok', ranAt: '2026-08-25T10:00:00.000Z', error: null }],
    });
    render(<App />);
    await screen.findByRole('tab', { name: /postings/i });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

    render(<App />);
    // The posting is scored under version 1 and current is 1: no badge.
    await screen.findByText('Senior Node Engineer');
    expect(screen.queryByRole('img', { name: /stale/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /settings/i }));
    const growth = await screen.findByLabelText('Growth');
    await userEvent.clear(growth);
    await userEvent.type(growth, '99');
    await userEvent.click(within(screen.getByRole('region', { name: 'Rubric & weights' }))
      .getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(screen.getByText(/version 2/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole('tab', { name: /postings/i }));
    expect(await screen.findByRole('img', { name: /stale/i })).toBeInTheDocument();
  });
});

