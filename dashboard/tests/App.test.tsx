import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';

const posting = {
  postingId: 'x:1', title: 'Senior Node Engineer', company: 'Acme',
  url: 'https://e.com/1', source: 'djinni', location: 'Remote',
  total: 82, verdict: 'STRONG', reasoning: 'r', providerId: 'p',
  scoredAt: '2026-08-25T10:00:00.000Z',
};

function mockFetch(handler: (url: string) => { body: unknown; status?: number }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const { body, status = 200 } = handler(String(input));
    return new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
  });
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('App', () => {
  it('shows a loading state, then the table', async () => {
    vi.stubGlobal('fetch', mockFetch((url) =>
      url.startsWith('/api/postings') ? { body: { postings: [posting] } } : { body: { sources: [] } }));
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
    const fetchMock = mockFetch((url) =>
      url.startsWith('/api/postings') ? { body: { postings: [posting] } } : { body: { sources: [] } });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await waitFor(() => expect(screen.getByText('Senior Node Engineer')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText(/verdict/i), 'MAYBE');
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('verdict=MAYBE'))).toBe(true);
    });
  });

  it('renders the source health panel', async () => {
    vi.stubGlobal('fetch', mockFetch((url) =>
      url.startsWith('/api/postings')
        ? { body: { postings: [posting] } }
        : { body: { sources: [{ source: 'djinni', status: 'error', ranAt: '2026-08-25T10:00:00.000Z', error: 'selector miss' }] } }));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/selector miss/)).toBeInTheDocument());
  });
});
