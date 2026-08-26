import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RejectedStrip } from '../src/components/postings/RejectedStrip';
import { DashboardDataProvider, type DashboardData } from '../src/context/DashboardData';
import { DEFAULT_FILTERS } from '../src/api/filters-url';
import type { PostingRow, SubScores } from '../src/api/types';

const DIM = { score: 0, note: 'hard filter' };
const SUBSCORES: SubScores = {
  coreStack: DIM, seniority: DIM, domain: DIM, logistics: DIM, growth: DIM,
};
const NOW = new Date('2026-08-26T12:00:00.000Z');
const emptyState = { data: null, error: null, loading: false, reload: () => {} };

function rejected(id: string, rule: string): PostingRow {
  return {
    postingId: id, title: `Role ${id}`, company: 'C', url: `https://e.com/${id}`,
    source: 'djinni', location: 'Moscow', total: 0, verdict: 'NO',
    reasoning: `hard-filter:${rule}`, providerId: 'hard-filter',
    settingsVersion: '3', scoredAt: '2026-08-26T06:00:00.000Z', subscores: SUBSCORES,
  };
}

function renderStrip(showRejected: boolean, rows: PostingRow[]) {
  const setUi = vi.fn();
  const value = {
    postings: emptyState, health: emptyState, settings: emptyState,
    ui: { ...DEFAULT_FILTERS, showRejected }, setUi,
  } as unknown as DashboardData;

  render(
    <MemoryRouter>
      <DashboardDataProvider value={value}>
        <RejectedStrip rows={rows} currentVersion={3} now={NOW} />
      </DashboardDataProvider>
    </MemoryRouter>,
  );
  return setUi;
}

describe('RejectedStrip', () => {
  const rows = [
    rejected('a', 'location'), rejected('b', 'location'), rejected('c', 'salary'),
  ];

  it('renders nothing when nothing was rejected', () => {
    const { container } = render(
      <MemoryRouter>
        <DashboardDataProvider value={{
          postings: emptyState, health: emptyState, settings: emptyState,
          ui: DEFAULT_FILTERS, setUi: () => {},
        } as unknown as DashboardData}>
          <RejectedStrip rows={[]} currentVersion={3} now={NOW} />
        </DashboardDataProvider>
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('counts the rejections and breaks them down by rule', () => {
    renderStrip(false, rows);
    expect(screen.getByText(/3 postings never reached the model/i)).toBeInTheDocument();
    expect(screen.getByText(/2 location/i)).toBeInTheDocument();
    expect(screen.getByText(/1 salary/i)).toBeInTheDocument();
  });

  it('keeps the rows out of sight until asked', () => {
    renderStrip(false, rows);
    expect(screen.queryByText('Role a')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show them/i })).toBeInTheDocument();
  });

  it('publishes the request to show them', async () => {
    const setUi = renderStrip(false, rows);
    await userEvent.click(screen.getByRole('button', { name: /show them/i }));
    expect(setUi).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, showRejected: true });
  });

  it('renders the rows and offers to hide them again when expanded', () => {
    renderStrip(true, rows);
    expect(screen.getByText('Role a')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide them/i })).toBeInTheDocument();
  });

  it('uses the singular for one rejection', () => {
    renderStrip(false, [rejected('a', 'salary')]);
    expect(screen.getByText(/1 posting never reached the model/i)).toBeInTheDocument();
  });
});
