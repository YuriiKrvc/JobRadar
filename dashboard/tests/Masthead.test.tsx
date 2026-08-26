import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Masthead } from '../src/components/Masthead';
import { SetupBanner } from '../src/components/SetupBanner';

function renderMasthead(props: Partial<Parameters<typeof Masthead>[0]> = {}) {
  return render(
    <MemoryRouter>
      <Masthead
        runAt="2026-08-26T06:12:00.000Z" newCount={4} scoredCount={128}
        version={12} {...props}
      />
    </MemoryRouter>,
  );
}

describe('Masthead', () => {
  it('names both sections as tabs', () => {
    renderMasthead();
    expect(screen.getByRole('tab', { name: /postings/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  it('marks the current route as the selected tab', () => {
    renderMasthead();
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /settings/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('states the run, the new count and the settings version', () => {
    renderMasthead();
    expect(screen.getByText(/4 new/i)).toBeInTheDocument();
    expect(screen.getByText(/128 scored/i)).toBeInTheDocument();
    expect(screen.getByText(/v12/i)).toBeInTheDocument();
  });

  it('says so when nothing has run yet', () => {
    renderMasthead({ runAt: null });
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument();
  });
});

describe('SetupBanner', () => {
  it('is an alert naming the reason and linking to settings', () => {
    render(<MemoryRouter><SetupBanner message="settings incomplete: no CV" /></MemoryRouter>);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(/no CV/);
    expect(screen.getByRole('link', { name: /finish setup/i })).toHaveAttribute('href', '/settings');
  });
});
