import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../src/components/SettingsPage';
import { useApi } from '../src/hooks/useApi';
import * as api from '../src/api/settings';

// SettingsPage takes its settings state from App, so the tests supply the same
// state App would: one useApi over fetchSettings, reload and all.
function Harness() {
  const settings = useApi(() => api.fetchSettings());
  return <SettingsPage settings={settings} />;
}

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };
const SETTINGS = {
  cv: 'existing cv', rubricBody: 'existing rubric', rubricWeights: WEIGHTS,
  profile: {
    excludedLocations: [], allowedEmploymentTypes: [], minSalaryUsd: null, timezone: 'Europe/Kyiv',
    blockedTitleWords: [], blockedDescriptionWords: [],
  },
  version: 3, updatedAt: '2026-08-25T10:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'fetchSettings').mockResolvedValue({ ...SETTINGS });
  vi.spyOn(api, 'fetchSources').mockResolvedValue([]);
});

describe('SettingsPage CV section', () => {
  it('carries the section blurb and a live character and word count', async () => {
    render(<Harness />);
    const cv = within(await screen.findByRole('region', { name: 'CV' }));
    expect(cv.getByText('The text every posting is scored against.')).toBeInTheDocument();
    // 'existing cv' — 11 characters, 2 words.
    expect(cv.getByText('11 characters · 2 words')).toBeInTheDocument();

    await userEvent.type(cv.getByLabelText(/^cv/i), '!');
    expect(cv.getByText('12 characters · 2 words')).toBeInTheDocument();
  });

  it('turns off spellcheck: a CV is not prose the browser should second-guess', async () => {
    render(<Harness />);
    await screen.findByDisplayValue('existing cv');
    expect(within(screen.getByRole('region', { name: 'CV' })).getByLabelText(/^cv/i)).toHaveAttribute('spellcheck', 'false');
  });

  it('loads the current cv into the textarea', async () => {
    render(<Harness />);
    expect(await screen.findByDisplayValue('existing cv')).toBeInTheDocument();
  });

  it('disables Save until the value changes', async () => {
    render(<Harness />);
    await screen.findByDisplayValue('existing cv');

    const save = within(screen.getByRole('region', { name: 'CV' })).getByRole('button', { name: /^Save/ });
    expect(save).toBeDisabled();

    await userEvent.type(within(screen.getByRole('region', { name: 'CV' })).getByLabelText(/^cv/i), '!');
    expect(save).toBeEnabled();
  });

  it('saves the edited cv', async () => {
    const saveCv = vi.spyOn(api, 'saveCv').mockResolvedValue(4);
    render(<Harness />);
    await screen.findByDisplayValue('existing cv');

    await userEvent.type(within(screen.getByRole('region', { name: 'CV' })).getByLabelText(/^cv/i), ' more');
    await userEvent.click(within(screen.getByRole('region', { name: 'CV' })).getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(saveCv).toHaveBeenCalledWith('existing cv more'));
  });

  it('shows the server message, keeps the input, and does not refetch on failure', async () => {
    const fetchSettings = vi.spyOn(api, 'fetchSettings').mockResolvedValue({ ...SETTINGS });
    vi.spyOn(api, 'saveCv').mockRejectedValue(new Error('cv: Required'));
    render(<Harness />);
    await screen.findByDisplayValue('existing cv');

    await userEvent.type(within(screen.getByRole('region', { name: 'CV' })).getByLabelText(/^cv/i), ' x');
    await userEvent.click(within(screen.getByRole('region', { name: 'CV' })).getByRole('button', { name: /^Save/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cv: Required');
    expect(within(screen.getByRole('region', { name: 'CV' })).getByLabelText(/^cv/i)).toHaveValue('existing cv x');

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

    render(<Harness />);
    await screen.findByDisplayValue('existing cv');

    await userEvent.type(within(screen.getByRole('region', { name: 'CV' })).getByLabelText(/^cv/i), ' more');
    await userEvent.click(within(screen.getByRole('region', { name: 'CV' })).getByRole('button', { name: /^Save/ }));

    // While the save is in flight, the textarea must be locked so further
    // keystrokes cannot be silently clobbered by the post-save reload.
    expect(within(screen.getByRole('region', { name: 'CV' })).getByLabelText(/^cv/i)).toBeDisabled();

    resolveSave(4);

    await waitFor(() => expect(fetchSettings).toHaveBeenCalledTimes(2));
    expect(await screen.findByDisplayValue('server cv after concurrent edit')).toBeInTheDocument();
  });

  it('shows the current settings version', async () => {
    render(<Harness />);
    expect(await screen.findByText(/version 3/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    vi.spyOn(api, 'fetchSettings').mockRejectedValue(new Error('db exploded'));
    render(<Harness />);
    expect(await screen.findByRole('alert')).toHaveTextContent('db exploded');
  });
});

/**
 * All four sections share one reload(). Before the fix SettingsPage returned
 * "Loading…" while `loading` was true, so a reload unmounted the whole subtree
 * and remounted it from the server; and the two OBJECT props (profile,
 * rubricWeights) got fresh identities on every fetch, re-firing the children's
 * seeding effects. Either path throws away unsaved edits in the sections the
 * user did not save, with no message.
 */
describe('unsaved edits across sections', () => {
  it('keeps an unsaved profile edit when the CV is saved', async () => {
    vi.spyOn(api, 'saveCv').mockResolvedValue(4);
    render(<Harness />);
    await screen.findByDisplayValue('existing cv');

    // Type a salary in Profile, deliberately WITHOUT saving it.
    await userEvent.type(screen.getByLabelText(/minimum salary/i), '7000');
    expect(screen.getByLabelText(/minimum salary/i)).toHaveValue(7000);

    // Save a different section.
    await userEvent.type(within(screen.getByRole('region', { name: 'CV' })).getByLabelText(/^cv/i), ' more');
    await userEvent.click(within(screen.getByRole('region', { name: 'CV' })).getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(api.fetchSettings).toHaveBeenCalledTimes(2));

    // The reload must not have reset Profile.
    expect(screen.getByLabelText(/minimum salary/i)).toHaveValue(7000);
    expect(within(screen.getByRole('region', { name: 'Profile & hard filters' }))
      .getByRole('button', { name: /^Save/ })).toBeEnabled();
  });

  it('keeps an unsaved rubric weight edit when the CV is saved', async () => {
    vi.spyOn(api, 'saveCv').mockResolvedValue(4);
    render(<Harness />);
    await screen.findByDisplayValue('existing cv');

    const growth = screen.getByLabelText('growth');
    await userEvent.clear(growth);
    await userEvent.type(growth, '99');

    await userEvent.type(within(screen.getByRole('region', { name: 'CV' })).getByLabelText(/^cv/i), ' more');
    await userEvent.click(within(screen.getByRole('region', { name: 'CV' })).getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(api.fetchSettings).toHaveBeenCalledTimes(2));

    expect(screen.getByLabelText('growth')).toHaveValue(99);
  });

  it('never unmounts the sections during a reload', async () => {
    let resolveSecond: (v: typeof SETTINGS) => void = () => {};
    vi.spyOn(api, 'fetchSettings')
      .mockResolvedValueOnce({ ...SETTINGS })
      .mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));
    vi.spyOn(api, 'saveCv').mockResolvedValue(4);

    render(<Harness />);
    await screen.findByDisplayValue('existing cv');

    await userEvent.type(within(screen.getByRole('region', { name: 'CV' })).getByLabelText(/^cv/i), ' more');
    await userEvent.click(within(screen.getByRole('region', { name: 'CV' })).getByRole('button', { name: /^Save/ }));

    // The refetch is still in flight: the form must still be on screen rather
    // than replaced by a "Loading…" placeholder.
    await waitFor(() => expect(api.fetchSettings).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText(/minimum salary/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Loading…$/)).not.toBeInTheDocument();

    resolveSecond({ ...SETTINGS, version: 4 });
    expect(await screen.findByText(/version 4/i)).toBeInTheDocument();
  });
});

