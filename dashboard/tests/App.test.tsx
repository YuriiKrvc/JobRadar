import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
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
