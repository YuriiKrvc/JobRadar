import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LedgerRow } from '../src/components/postings/LedgerRow';
import type { PostingRow, RubricWeights, SubScores } from '../src/api/types';

const WEIGHTS: RubricWeights = {
  coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10,
};

const SUBSCORES: SubScores = {
  coreStack: { score: 90, note: 'Nine years on this exact stack.' },
  seniority: { score: 80, note: 'Staff-level scope.' },
  domain: { score: 60, note: 'Fintech adjacent.' },
  logistics: { score: 75, note: 'Hybrid in your city.' },
  growth: { score: 70, note: 'Platform team, room to grow.' },
};

const NOW = new Date('2026-08-26T12:00:00.000Z');

function row(over: Partial<PostingRow> = {}): PostingRow {
  return {
    postingId: 'x:1', title: 'Senior Platform Engineer', company: 'Monobank',
    url: 'https://e.com/1', source: 'djinni', location: 'Kyiv, hybrid',
    total: 82, verdict: 'STRONG', reasoning: 'Nine years on the exact stack you list.',
    providerId: 'claude-opus-5', settingsVersion: '3',
    scoredAt: '2026-08-26T06:00:00.000Z', subscores: SUBSCORES, ...over,
  };
}

function renderRow(over: Partial<PostingRow> = {}, currentVersion: number | null = 3) {
  return render(
    <MemoryRouter>
      <LedgerRow row={row(over)} currentVersion={currentVersion} weights={WEIGHTS} now={NOW} />
    </MemoryRouter>,
  );
}

describe('LedgerRow', () => {
  it('shows the score, the verdict word and a link to the vacancy', () => {
    renderRow();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('STRONG')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Senior Platform Engineer/ }))
      .toHaveAttribute('href', 'https://e.com/1');
  });

  it('opens the vacancy in a new tab safely', () => {
    renderRow();
    const link = screen.getByRole('link', { name: /Senior Platform Engineer/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('speaks the pip row as a counted verdict', () => {
    renderRow();
    expect(screen.getByRole('img', { name: /3 of 3/i })).toBeInTheDocument();
  });

  it('speaks one pip for a NO', () => {
    renderRow({ verdict: 'NO', total: 20 });
    expect(screen.getByRole('img', { name: /1 of 3/i })).toBeInTheDocument();
  });

  it('says the location is not stated when it is null', () => {
    renderRow({ location: null });
    expect(screen.getByText(/location not stated/i)).toBeInTheDocument();
  });

  it('shows the relative scoring time', () => {
    renderRow();
    expect(screen.getByText('6h')).toBeInTheDocument();
  });

  it('tags a near miss with the numeric gap', () => {
    renderRow({ verdict: 'NO', total: 44 });
    expect(screen.getByText(/near miss/i)).toBeInTheDocument();
    expect(screen.getByText(/6 under/i)).toBeInTheDocument();
  });

  it('tags a stale score with its version and a spoken label', () => {
    renderRow({ settingsVersion: '2' }, 3);
    expect(screen.getByRole('img', { name: /settings version 2/i })).toBeInTheDocument();
  });

  it('does not tag a current score as stale', () => {
    renderRow({ settingsVersion: '3' }, 3);
    expect(screen.queryByRole('img', { name: /settings version/i })).not.toBeInTheDocument();
  });
});

describe('LedgerRow breakdown', () => {
  it('is collapsed until asked for', () => {
    renderRow();
    expect(screen.getByRole('button', { name: /breakdown/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/nine years on this exact stack/i)).not.toBeInTheDocument();
  });

  it('expands to the five dimensions with their notes and weight shares', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /breakdown/i }));

    expect(screen.getByText(/nine years on this exact stack/i)).toBeInTheDocument();
    expect(screen.getByText(/fintech adjacent/i)).toBeInTheDocument();
    // 35 of a 100-point weight sum.
    expect(screen.getByText('35%')).toBeInTheDocument();
  });

  it('speaks every bar value in one label', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /breakdown/i }));

    const chart = screen.getByRole('img', { name: /core stack 90/i });
    expect(chart.getAttribute('aria-label')).toContain('domain 60');
  });

  it('draws a stale row’s bars in neutral ink', async () => {
    renderRow({ settingsVersion: '2' }, 3);
    await userEvent.click(screen.getByRole('button', { name: /breakdown/i }));

    const chart = screen.getByRole('img', { name: /core stack 90/i });
    expect(chart.className).toMatch(/stale/);
  });
});

describe('LedgerRow for a rejected posting', () => {
  const rejected = {
    providerId: 'hard-filter', reasoning: 'hard-filter:location',
    total: 0, verdict: 'NO' as const,
  };

  it('reads the rejection as a sentence, never as the machine string', () => {
    renderRow(rejected);
    expect(screen.getByText(/excluded location/i)).toBeInTheDocument();
    expect(screen.queryByText(/hard-filter:location/)).not.toBeInTheDocument();
  });

  it('tags the rule and links to the rule that rejected it', () => {
    renderRow(rejected);
    expect(screen.getByText(/filtered · location/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /edit the rule/i })).toHaveAttribute('href', '/settings');
  });

  it('offers no breakdown, because there is nothing to break down', () => {
    renderRow(rejected);
    expect(screen.queryByRole('button', { name: /breakdown/i })).not.toBeInTheDocument();
  });
});
