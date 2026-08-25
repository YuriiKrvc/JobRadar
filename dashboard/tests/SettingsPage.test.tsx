import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../src/components/SettingsPage';
import * as api from '../src/api/settings';

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };
const SETTINGS = {
  cv: 'existing cv', rubricBody: 'existing rubric', rubricWeights: WEIGHTS,
  profile: {
    excludedLocations: [], allowedEmploymentTypes: [], minSalaryUsd: null, timezone: 'Europe/Kyiv',
  },
  version: 3, updatedAt: '2026-08-25T10:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'fetchSettings').mockResolvedValue({ ...SETTINGS });
  vi.spyOn(api, 'fetchSources').mockResolvedValue([]);
});

describe('SettingsPage CV section', () => {
  it('loads the current cv into the textarea', async () => {
    render(<SettingsPage />);
    expect(await screen.findByDisplayValue('existing cv')).toBeInTheDocument();
  });

  it('disables Save until the value changes', async () => {
    render(<SettingsPage />);
    await screen.findByDisplayValue('existing cv');

    const save = screen.getByRole('button', { name: /save cv/i });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^cv$/i), '!');
    expect(save).toBeEnabled();
  });

  it('saves the edited cv', async () => {
    const saveCv = vi.spyOn(api, 'saveCv').mockResolvedValue(4);
    render(<SettingsPage />);
    await screen.findByDisplayValue('existing cv');

    await userEvent.type(screen.getByLabelText(/^cv$/i), ' more');
    await userEvent.click(screen.getByRole('button', { name: /save cv/i }));

    await waitFor(() => expect(saveCv).toHaveBeenCalledWith('existing cv more'));
  });

  it('shows the server message and keeps the input on failure', async () => {
    vi.spyOn(api, 'saveCv').mockRejectedValue(new Error('cv: Required'));
    render(<SettingsPage />);
    await screen.findByDisplayValue('existing cv');

    await userEvent.type(screen.getByLabelText(/^cv$/i), ' x');
    await userEvent.click(screen.getByRole('button', { name: /save cv/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cv: Required');
    expect(screen.getByLabelText(/^cv$/i)).toHaveValue('existing cv x');
  });

  it('shows the current settings version', async () => {
    render(<SettingsPage />);
    expect(await screen.findByText(/version 3/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    vi.spyOn(api, 'fetchSettings').mockRejectedValue(new Error('db exploded'));
    render(<SettingsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('db exploded');
  });
});
