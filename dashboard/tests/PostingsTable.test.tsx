import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PostingsTable } from '../src/components/PostingsTable';
import type { PostingRow } from '../src/api/types';

const rows: PostingRow[] = [
  {
    postingId: 'x:1', title: 'Senior Node Engineer', company: 'Acme',
    url: 'https://e.com/1', source: 'djinni', location: 'Remote',
    total: 82, verdict: 'STRONG', reasoning: 'stack matches',
    providerId: 'p', scoredAt: '2026-08-25T10:00:00.000Z', settingsVersion: '1',
  },
  {
    postingId: 'x:2', title: 'Mid Node Dev', company: 'Beta',
    url: 'https://e.com/2', source: 'dou', location: null,
    total: 44, verdict: 'NO', reasoning: 'near miss',
    providerId: 'p', scoredAt: '2026-08-25T09:00:00.000Z', settingsVersion: '1',
  },
  {
    postingId: 'x:3', title: 'Junior Dev', company: 'Gamma',
    url: 'https://e.com/3', source: 'dou', location: 'Kyiv',
    total: 12, verdict: 'NO', reasoning: 'too junior',
    providerId: 'p', scoredAt: '2026-08-25T08:00:00.000Z', settingsVersion: '1',
  },
];

describe('PostingsTable', () => {
  it('renders one row per posting with a link to the vacancy', () => {
    render(<PostingsTable rows={rows} currentVersion={1} />);
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1);
    expect(screen.getByRole('link', { name: /Senior Node Engineer/ }))
      .toHaveAttribute('href', 'https://e.com/1');
  });

  it('marks scores of 40-49 with a NO verdict as near misses', () => {
    render(<PostingsTable rows={rows} currentVersion={1} />);
    expect(screen.getByText('Mid Node Dev').closest('tr')).toHaveClass('row-near-miss');
    expect(screen.getByText('Junior Dev').closest('tr')).not.toHaveClass('row-near-miss');
  });

  it('sorts by total descending by default', () => {
    render(<PostingsTable rows={rows} currentVersion={1} />);
    const body = screen.getAllByRole('row').slice(1);
    expect(within(body[0]!).getByText('82')).toBeInTheDocument();
  });

  it('reverses the sort when the score header is clicked', async () => {
    render(<PostingsTable rows={rows} currentVersion={1} />);
    await userEvent.click(screen.getByRole('columnheader', { name: /score/i }));
    const body = screen.getAllByRole('row').slice(1);
    expect(within(body[0]!).getByText('12')).toBeInTheDocument();
  });

  it('renders an em dash for a missing location', () => {
    render(<PostingsTable rows={rows} currentVersion={1} />);
    const row = screen.getByText('Mid Node Dev').closest('tr')!;
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('shows an empty state when there are no rows', () => {
    render(<PostingsTable rows={[]} currentVersion={1} />);
    expect(screen.getByText(/no postings scored yet/i)).toBeInTheDocument();
  });
});

describe('stale settings badge', () => {
  const row = (over: Partial<PostingRow> = {}): PostingRow => ({
    postingId: 'a:1', title: 'T', company: 'C', url: 'https://e.com/1',
    source: 'ats', location: 'Remote', total: 80, verdict: 'STRONG',
    reasoning: 'ok', providerId: 'fake', scoredAt: '2026-08-25T10:00:00.000Z',
    settingsVersion: '3', ...over,
  });

  it('badges a score from an older settings version', () => {
    render(<PostingsTable rows={[row({ settingsVersion: '2' })]} currentVersion={3} />);
    expect(screen.getByTitle(/scored under settings version 2/i)).toBeInTheDocument();
  });

  it('does not badge a current score', () => {
    render(<PostingsTable rows={[row({ settingsVersion: '3' })]} currentVersion={3} />);
    expect(screen.queryByTitle(/scored under settings/i)).not.toBeInTheDocument();
  });

  it('does not badge when the current version is unknown', () => {
    render(<PostingsTable rows={[row({ settingsVersion: '2' })]} currentVersion={null} />);
    expect(screen.queryByTitle(/scored under settings/i)).not.toBeInTheDocument();
  });
});
