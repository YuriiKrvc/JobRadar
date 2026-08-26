import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SourceHealth, groupRuns } from '../src/components/SourceHealth';
import type { HealthRow } from '../src/api/types';

function run(source: string, status: string, minutesAgo: number, error: string | null = null): HealthRow {
  return {
    source, status, error,
    ranAt: new Date(Date.parse('2026-08-26T12:00:00.000Z') - minutesAgo * 60_000).toISOString(),
  };
}

describe('groupRuns', () => {
  it('groups the run log by source, newest first', () => {
    const groups = groupRuns([
      run('djinni', 'ok', 0), run('dou', 'error', 5, 'selector miss'),
      run('djinni', 'ok', 30),
    ]);

    expect(groups.map((g) => g.source)).toEqual(['djinni', 'dou']);
    expect(groups[0]!.runs).toHaveLength(2);
  });

  it('takes the status and error from the newest run of each source', () => {
    const groups = groupRuns([run('dou', 'error', 1, 'selector miss'), run('dou', 'ok', 60)]);
    expect(groups[0]!.status).toBe('error');
    expect(groups[0]!.error).toBe('selector miss');
  });

  it('keeps at most ten runs per source', () => {
    const rows = Array.from({ length: 14 }, (_, i) => run('djinni', 'ok', i));
    expect(groupRuns(rows)[0]!.runs).toHaveLength(10);
  });
});

describe('SourceHealth', () => {
  it('renders nothing when the run log is empty', () => {
    const { container } = render(<MemoryRouter><SourceHealth rows={[]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one panel per source with a spoken run strip', () => {
    render(<MemoryRouter><SourceHealth rows={[run('djinni', 'ok', 0), run('dou', 'ok', 1)]} /></MemoryRouter>);

    expect(screen.getByText('djinni')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /last 1 runs? of djinni/i })).toBeInTheDocument();
  });

  it('raises an alert naming how many boards are failing', () => {
    render(
      <MemoryRouter>
        <SourceHealth rows={[run('djinni', 'ok', 0), run('dou', 'error', 1, 'selector miss')]} />
      </MemoryRouter>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/1 source failing/i);
    expect(alert).toHaveTextContent(/may be incomplete/i);
  });

  it('shows the error text and a repair link for a failing board', () => {
    render(<MemoryRouter><SourceHealth rows={[run('dou', 'error', 1, 'selector miss')]} /></MemoryRouter>);

    expect(screen.getByText(/selector miss/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /repair this source/i }))
      .toHaveAttribute('href', '/settings');
  });

  it('never lists the settings pseudo-source as a board', () => {
    render(
      <MemoryRouter>
        <SourceHealth rows={[run('settings', 'error', 1, 'settings incomplete: no CV')]} />
      </MemoryRouter>,
    );
    // SetupBanner speaks for that condition; a second alert here would be a
    // duplicate, and "settings" is not a job board.
    expect(screen.queryByText('settings')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('raises no alert when every board is ok', () => {
    render(<MemoryRouter><SourceHealth rows={[run('djinni', 'ok', 0)]} /></MemoryRouter>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
