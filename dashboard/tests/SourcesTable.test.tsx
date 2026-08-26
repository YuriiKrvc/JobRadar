import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourcesTable } from '../src/components/SourcesTable';

const ROW = {
  id: 'u1', name: 'Acme', url: 'https://acme.com/careers',
  selectors: { item: 'li.opening', link: 'a.t' },
  blockedTitleWords: [], blockedDescriptionWords: [],
  enabled: true, createdAt: '2026-01-01T00:00:00Z',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

/** Answers GET /api/sources from `rows`; every other call falls to `handler`. */
function mockFetch(rows: unknown[], handler: (url: string, init?: RequestInit) => Response) {
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') return json({ sources: rows });
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

afterEach(() => vi.unstubAllGlobals());

async function fillRequired() {
  await userEvent.type(screen.getByLabelText('Name'), 'Beta');
  await userEvent.type(screen.getByLabelText('Listing URL'), 'https://beta.com/jobs');
  await userEvent.type(screen.getByLabelText('Item'), 'li.job');
  await userEvent.type(screen.getByLabelText('Link'), 'a');
}

it('lists a source by name and URL', async () => {
  mockFetch([ROW], () => json({}));
  render(<SourcesTable />);
  expect(await screen.findByText('Acme')).toBeInTheDocument();
  expect(screen.getByText('https://acme.com/careers')).toBeInTheDocument();
});

it('shows the empty state when there are no sources', async () => {
  mockFetch([], () => json({}));
  render(<SourcesTable />);
  expect(await screen.findByText('No sources configured — add one below.')).toBeInTheDocument();
});

it('renders a disabled row with the row-disabled class', async () => {
  mockFetch([{ ...ROW, enabled: false }], () => json({}));
  render(<SourcesTable />);
  const cell = await screen.findByText('Acme');
  expect(cell.closest('tr')).toHaveClass('row-disabled');
});

it('toggles a source and reloads', async () => {
  const fetchFn = mockFetch([ROW], () => json({ source: { ...ROW, enabled: false } }));
  render(<SourcesTable />);
  await userEvent.click(await screen.findByLabelText('Enable Acme'));
  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith(
    '/api/sources/u1', expect.objectContaining({ method: 'PATCH' }),
  ));
});

it('deletes a source and reloads', async () => {
  const fetchFn = mockFetch([ROW], () => new Response(null, { status: 204 }));
  render(<SourcesTable />);
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith(
    '/api/sources/u1', expect.objectContaining({ method: 'DELETE' }),
  ));
});

it('adds a source through the form', async () => {
  const fetchFn = mockFetch([], () => json({ source: ROW }));
  render(<SourcesTable />);
  await screen.findByText('No sources configured — add one below.');
  await fillRequired();
  await userEvent.click(screen.getByRole('button', { name: 'Add source' }));

  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('/api/sources', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({
      name: 'Beta', url: 'https://beta.com/jobs',
      selectors: { item: 'li.job', link: 'a' },
      blockedTitleWords: [], blockedDescriptionWords: [],
    }),
  })));
});

it('opens an edit form pre-filled from the row and saves it with PUT', async () => {
  const fetchFn = mockFetch([ROW], () => json({ source: ROW }));
  render(<SourcesTable />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

  expect(screen.getByLabelText('Name')).toHaveValue('Acme');
  const item = screen.getByLabelText('Item (required)');
  expect(item).toHaveValue('li.opening');
  await userEvent.clear(item);
  await userEvent.type(item, 'div.card');
  await userEvent.click(screen.getByRole('button', { name: 'Save source' }));

  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('/api/sources/u1', expect.objectContaining({
    method: 'PUT',
    body: JSON.stringify({
      name: 'Acme', url: 'https://acme.com/careers',
      selectors: { item: 'div.card', link: 'a.t' },
      blockedTitleWords: [], blockedDescriptionWords: [],
    }),
  })));
});

it('closes the edit form on cancel without saving', async () => {
  const fetchFn = mockFetch([ROW], () => json({}));
  render(<SourcesTable />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByRole('button', { name: 'Save source' })).toBeNull();
  expect(fetchFn.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
});

it('keeps the edit form open and dirty when the save fails', async () => {
  mockFetch([ROW], () => json({ message: 'Another source already uses that name' }, 409));
  render(<SourcesTable />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

  const name = screen.getByLabelText('Name');
  await userEvent.clear(name);
  await userEvent.type(name, 'Beta');
  await userEvent.click(screen.getByRole('button', { name: 'Save source' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Another source already uses that name');
  expect(screen.getByLabelText('Name')).toHaveValue('Beta');
});
