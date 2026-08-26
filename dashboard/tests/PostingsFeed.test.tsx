import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PostingsFeed } from '../src/components/postings/PostingsFeed';
import { EmptyState } from '../src/components/postings/EmptyState';
import type { PostingRow, RubricWeights, SubScores } from '../src/api/types';

const WEIGHTS: RubricWeights = {
  coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10,
};
const DIM = { score: 50, note: 'n' };
const SUBSCORES: SubScores = {
  coreStack: DIM, seniority: DIM, domain: DIM, logistics: DIM, growth: DIM,
};
const NOW = new Date('2026-08-26T12:00:00.000Z');

function row(over: Partial<PostingRow> = {}): PostingRow {
  return {
    postingId: 'x:1', title: 'A Role', company: 'C', url: 'https://e.com/1',
    source: 'djinni', location: 'Remote', total: 80, verdict: 'STRONG',
    reasoning: 'r', providerId: 'anthropic', settingsVersion: '3',
    scoredAt: '2026-08-26T06:00:00.000Z', subscores: SUBSCORES, ...over,
  };
}

function renderFeed(rows: PostingRow[]) {
  return render(
    <MemoryRouter>
      <PostingsFeed rows={rows} currentVersion={3} weights={WEIGHTS} now={NOW} descending />
    </MemoryRouter>,
  );
}

describe('PostingsFeed', () => {
  it('groups rows under day dividers carrying a date and a count', () => {
    renderFeed([
      row({ postingId: 'a', title: 'Today role' }),
      row({ postingId: 'b', title: 'Old role', scoredAt: '2026-08-25T06:00:00.000Z' }),
    ]);

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText(/26 August · 1 new/)).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('renders the column heads once, not per group', () => {
    renderFeed([row({ postingId: 'a' }), row({ postingId: 'b', scoredAt: '2026-08-25T06:00:00.000Z' })]);
    expect(screen.getAllByText(/role \/ company/i)).toHaveLength(1);
  });

  it('renders one row per posting', () => {
    renderFeed([row({ postingId: 'a', title: 'One' }), row({ postingId: 'b', title: 'Two' })]);
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
  });

  it('leaves hard-filtered rows out of the feed entirely', () => {
    renderFeed([
      row({ postingId: 'a', title: 'A kept role' }),
      row({
        postingId: 'b', title: 'A rejected role',
        providerId: 'hard-filter', reasoning: 'hard-filter:location',
      }),
    ]);

    expect(screen.getByText('A kept role')).toBeInTheDocument();
    expect(screen.queryByText('A rejected role')).not.toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('explains the pipeline on a fresh install', () => {
    render(<MemoryRouter><EmptyState kind="fresh" onClearFilters={() => {}} /></MemoryRouter>);

    expect(screen.getByText(/nothing on the radar yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /paste your cv/i })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: /add a job board/i })).toHaveAttribute('href', '/settings');
  });

  it('offers to clear the filters when they hide everything', () => {
    let cleared = false;
    render(
      <MemoryRouter>
        <EmptyState kind="filtered" onClearFilters={() => { cleared = true; }} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/no posting matches these filters/i)).toBeInTheDocument();
    screen.getByRole('button', { name: /clear filters/i }).click();
    expect(cleared).toBe(true);
  });
});
