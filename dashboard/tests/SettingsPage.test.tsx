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

  it('shows the server message, keeps the input, and does not refetch on failure', async () => {
    const fetchSettings = vi.spyOn(api, 'fetchSettings').mockResolvedValue({ ...SETTINGS });
    vi.spyOn(api, 'saveCv').mockRejectedValue(new Error('cv: Required'));
    render(<SettingsPage />);
    await screen.findByDisplayValue('existing cv');

    await userEvent.type(screen.getByLabelText(/^cv$/i), ' x');
    await userEvent.click(screen.getByRole('button', { name: /save cv/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cv: Required');
    expect(screen.getByLabelText(/^cv$/i)).toHaveValue('existing cv x');

    // A failed save must not trigger a refetch: reloading on failure is exactly
    // the path that could silently overwrite the user's rejected, unsaved edit.
    expect(fetchSettings).toHaveBeenCalledTimes(1);
  });

  it('locks the textarea while saving, then reflects a refetch that differs from the local value', async () => {
    const fetchSettings = vi.spyOn(api, 'fetchSettings')
      .mockResolvedValueOnce({ ...SETTINGS })
      .mockResolvedValueOnce({ ...SETTINGS, cv: 'server cv after concurrent edit' });

    let resolveSave: (version: number) => void = () => {};
    vi.spyOn(api, 'saveCv').mockImplementation(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );

    render(<SettingsPage />);
    await screen.findByDisplayValue('existing cv');

    await userEvent.type(screen.getByLabelText(/^cv$/i), ' more');
    await userEvent.click(screen.getByRole('button', { name: /save cv/i }));

    // While the save is in flight, the textarea must be locked so further
    // keystrokes cannot be silently clobbered by the post-save reload.
    expect(screen.getByLabelText(/^cv$/i)).toBeDisabled();

    resolveSave(4);

    await waitFor(() => expect(fetchSettings).toHaveBeenCalledTimes(2));
    expect(await screen.findByDisplayValue('server cv after concurrent edit')).toBeInTheDocument();
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
