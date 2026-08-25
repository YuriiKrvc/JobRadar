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
    providerId: 'p', scoredAt: '2026-08-25T10:00:00.000Z',
  },
  {
    postingId: 'x:2', title: 'Mid Node Dev', company: 'Beta',
    url: 'https://e.com/2', source: 'dou', location: null,
    total: 44, verdict: 'NO', reasoning: 'near miss',
    providerId: 'p', scoredAt: '2026-08-25T09:00:00.000Z',
  },
  {
    postingId: 'x:3', title: 'Junior Dev', company: 'Gamma',
    url: 'https://e.com/3', source: 'dou', location: 'Kyiv',
    total: 12, verdict: 'NO', reasoning: 'too junior',
    providerId: 'p', scoredAt: '2026-08-25T08:00:00.000Z',
  },
];

describe('PostingsTable', () => {
  it('renders one row per posting with a link to the vacancy', () => {
    render(<PostingsTable rows={rows} />);
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1);
    expect(screen.getByRole('link', { name: /Senior Node Engineer/ }))
      .toHaveAttribute('href', 'https://e.com/1');
  });

  it('marks scores of 40-49 with a NO verdict as near misses', () => {
    render(<PostingsTable rows={rows} />);
    expect(screen.getByText('Mid Node Dev').closest('tr')).toHaveClass('row-near-miss');
    expect(screen.getByText('Junior Dev').closest('tr')).not.toHaveClass('row-near-miss');
  });

  it('sorts by total descending by default', () => {
    render(<PostingsTable rows={rows} />);
    const body = screen.getAllByRole('row').slice(1);
    expect(within(body[0]!).getByText('82')).toBeInTheDocument();
  });

  it('reverses the sort when the score header is clicked', async () => {
    render(<PostingsTable rows={rows} />);
    await userEvent.click(screen.getByRole('columnheader', { name: /score/i }));
    const body = screen.getAllByRole('row').slice(1);
    expect(within(body[0]!).getByText('12')).toBeInTheDocument();
  });

  it('renders an em dash for a missing location', () => {
    render(<PostingsTable rows={rows} />);
    const row = screen.getByText('Mid Node Dev').closest('tr')!;
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('shows an empty state when there are no rows', () => {
    render(<PostingsTable rows={[]} />);
    expect(screen.getByText(/no postings scored yet/i)).toBeInTheDocument();
  });
});
