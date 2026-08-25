import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourcesTable } from '../src/components/SourcesTable';
import * as api from '../src/api/settings';
import type { SourceRow } from '../src/api/types';

const ats: SourceRow = {
  id: 'a1', kind: 'ats', board: 'greenhouse', slug: 'acme',
  url: null, enabled: true, createdAt: '2026-08-25T10:00:00.000Z',
};
const dou: SourceRow = {
  id: 'd1', kind: 'dou', board: null, slug: null,
  url: 'https://jobs.dou.ua/a/', enabled: false, createdAt: '2026-08-25T10:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'fetchSources').mockResolvedValue([ats, dou]);
});

describe('SourcesTable', () => {
  it('lists enabled and disabled sources with their identity', async () => {
    render(<SourcesTable />);
    expect(await screen.findByText('greenhouse:acme')).toBeInTheDocument();
    expect(screen.getByText('https://jobs.dou.ua/a/')).toBeInTheDocument();
  });

  it('reflects enabled state in the toggle', async () => {
    render(<SourcesTable />);
    const toggles = await screen.findAllByRole('checkbox');
    expect(toggles[0]).toBeChecked();
    expect(toggles[1]).not.toBeChecked();
  });

  it('toggles a source and refetches', async () => {
    const toggle = vi.spyOn(api, 'toggleSource').mockResolvedValue({ ...ats, enabled: false });
    render(<SourcesTable />);

    await userEvent.click((await screen.findAllByRole('checkbox'))[0]!);
    await waitFor(() => expect(toggle).toHaveBeenCalledWith('a1', false));
    expect(api.fetchSources).toHaveBeenCalledTimes(2);
  });

  it('deletes a source', async () => {
    const del = vi.spyOn(api, 'deleteSource').mockResolvedValue(undefined);
    render(<SourcesTable />);

    await userEvent.click((await screen.findAllByRole('button', { name: /delete/i }))[0]!);
    await waitFor(() => expect(del).toHaveBeenCalledWith('a1'));
  });

  it('shows board and slug fields for ats, url for the others', async () => {
    render(<SourcesTable />);
    await screen.findByText('greenhouse:acme');

    // The add form defaults to ats.
    expect(screen.getByLabelText(/board/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^url$/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/kind/i), 'djinni');
    expect(screen.queryByLabelText(/board/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^url$/i)).toBeInTheDocument();
  });

  it('adds an ats source', async () => {
    const add = vi.spyOn(api, 'addSource').mockResolvedValue(ats);
    render(<SourcesTable />);
    await screen.findByText('greenhouse:acme');

    await userEvent.selectOptions(screen.getByLabelText(/board/i), 'lever');
    await userEvent.type(screen.getByLabelText(/slug/i), 'globex');
    await userEvent.click(screen.getByRole('button', { name: /add source/i }));

    await waitFor(() => expect(add).toHaveBeenCalledWith({
      kind: 'ats', board: 'lever', slug: 'globex',
    }));
  });

  it('adds a url source', async () => {
    const add = vi.spyOn(api, 'addSource').mockResolvedValue(dou);
    render(<SourcesTable />);
    await screen.findByText('greenhouse:acme');

    await userEvent.selectOptions(screen.getByLabelText(/kind/i), 'dou');
    await userEvent.type(screen.getByLabelText(/^url$/i), 'https://jobs.dou.ua/b/');
    await userEvent.click(screen.getByRole('button', { name: /add source/i }));

    await waitFor(() => expect(add).toHaveBeenCalledWith({
      kind: 'dou', url: 'https://jobs.dou.ua/b/',
    }));
  });

  it('shows the 409 message and keeps the input', async () => {
    vi.spyOn(api, 'addSource').mockRejectedValue(
      new Error('That source is already configured'),
    );
    render(<SourcesTable />);
    await screen.findByText('greenhouse:acme');

    await userEvent.type(screen.getByLabelText(/slug/i), 'acme');
    await userEvent.click(screen.getByRole('button', { name: /add source/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already configured');
    expect(screen.getByLabelText(/slug/i)).toHaveValue('acme');
  });

  it('disables the add form fields while an add is pending', async () => {
    let resolveAdd!: (value: SourceRow) => void;
    const pending = new Promise<SourceRow>((resolve) => { resolveAdd = resolve; });
    vi.spyOn(api, 'addSource').mockReturnValue(pending);

    render(<SourcesTable />);
    await screen.findByText('greenhouse:acme');

    await userEvent.type(screen.getByLabelText(/slug/i), 'globex');
    await userEvent.click(screen.getByRole('button', { name: /add source/i }));

    await waitFor(() => expect(screen.getByLabelText(/kind/i)).toBeDisabled());
    expect(screen.getByLabelText(/board/i)).toBeDisabled();
    expect(screen.getByLabelText(/slug/i)).toBeDisabled();

    resolveAdd(ats);
    await waitFor(() => expect(screen.getByLabelText(/kind/i)).not.toBeDisabled());
    expect(screen.getByLabelText(/board/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/slug/i)).not.toBeDisabled();
  });

  it('says so when there are no sources at all', async () => {
    vi.spyOn(api, 'fetchSources').mockResolvedValue([]);
    render(<SourcesTable />);
    expect(await screen.findByText(/no sources configured/i)).toBeInTheDocument();
  });
});
