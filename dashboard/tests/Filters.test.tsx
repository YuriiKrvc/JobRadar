import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Filters } from '../src/components/postings/Filters';
import { DashboardDataProvider, type DashboardData } from '../src/context/DashboardData';
import { DEFAULT_FILTERS, type UiFilters } from '../src/api/filters-url';
import type { PostingRow } from '../src/api/types';

const DIM = { score: 0, note: 'n' };
const SUBSCORES = { coreStack: DIM, seniority: DIM, domain: DIM, logistics: DIM, growth: DIM };

const rows: PostingRow[] = [
  {
    postingId: 'x:1', title: 'A', company: 'C', url: 'https://e.com/1',
    source: 'djinni', location: null, total: 80, verdict: 'STRONG',
    reasoning: 'r', providerId: 'anthropic', settingsVersion: '1',
    scoredAt: '2026-08-26T10:00:00.000Z', subscores: SUBSCORES,
  },
  {
    postingId: 'x:2', title: 'B', company: 'D', url: 'https://e.com/2',
    source: 'dou', location: null, total: 40, verdict: 'NO',
    reasoning: 'r', providerId: 'openai', settingsVersion: '1',
    scoredAt: '2026-08-26T10:00:00.000Z', subscores: SUBSCORES,
  },
];

const emptyState = { data: null, error: null, loading: false, reload: () => {} };

function renderFilters(ui: UiFilters = DEFAULT_FILTERS) {
  const setUi = vi.fn();
  const value = {
    postings: emptyState, health: emptyState, settings: emptyState, ui, setUi,
  } as unknown as DashboardData;

  render(
    <DashboardDataProvider value={value}>
      <Filters rows={rows} resultCount={2} />
    </DashboardDataProvider>,
  );
  return setUi;
}

describe('Filters', () => {
  it('offers Any plus the three verdicts as pressable buttons', () => {
    renderFilters();
    for (const name of ['any', 'strong', 'maybe', 'no']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}$`, 'i') })).toBeInTheDocument();
    }
  });

  it('marks the active verdict as pressed', () => {
    renderFilters({ ...DEFAULT_FILTERS, verdict: 'MAYBE' });
    expect(screen.getByRole('button', { name: /^maybe$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^any$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('publishes a verdict choice', async () => {
    const setUi = renderFilters();
    await userEvent.click(screen.getByRole('button', { name: /^strong$/i }));
    expect(setUi).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, verdict: 'STRONG' });
  });

  it('lists the sources present in the rows', () => {
    renderFilters();
    const select = screen.getByLabelText(/source/i);
    expect(within(select).getByRole('option', { name: 'djinni' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'dou' })).toBeInTheDocument();
  });

  it('publishes a source choice', async () => {
    const setUi = renderFilters();
    await userEvent.selectOptions(screen.getByLabelText(/source/i), 'dou');
    expect(setUi).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, source: 'dou' });
  });

  it('does not publish while the score slider is being dragged', () => {
    const setUi = renderFilters();
    const slider = screen.getByLabelText(/minimum score/i);

    fireEvent.input(slider, { target: { value: '40' } });
    expect(setUi).not.toHaveBeenCalled();

    fireEvent.blur(slider);
    expect(setUi).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, minTotal: 40 });
  });

  it('shows the live slider value while dragging', () => {
    renderFilters();
    fireEvent.input(screen.getByLabelText(/minimum score/i), { target: { value: '65' } });
    expect(screen.getByText(/min score 65/i)).toBeInTheDocument();
  });

  it('reports the result count and toggles the sort', async () => {
    const setUi = renderFilters();
    expect(screen.getByText(/2 postings/i)).toBeInTheDocument();

    const sort = screen.getByRole('button', { name: /score/i });
    expect(sort).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(sort);
    expect(setUi).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, sort: 'asc' });
  });
});
