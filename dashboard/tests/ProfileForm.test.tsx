import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileForm } from '../src/components/ProfileForm';
import * as api from '../src/api/settings';

const BASE = {
  excludedLocations: ['United States'],
  allowedEmploymentTypes: [],
  minSalaryUsd: 5000,
  timezone: 'Europe/Kyiv',
  blockedTitleWords: ['intern'],
  blockedDescriptionWords: [],
};

beforeEach(() => vi.restoreAllMocks());

describe('ProfileForm', () => {
  it('renders the current profile', () => {
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);
    expect(screen.getByText('United States')).toBeInTheDocument();
    expect(screen.getByLabelText(/minimum salary/i)).toHaveValue(5000);
    expect(screen.getByLabelText(/timezone/i)).toHaveValue('Europe/Kyiv');
  });

  it('disables Save until something changes', async () => {
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);
    const save = screen.getByRole('button', { name: /^Save/ });
    expect(save).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.type(screen.getByLabelText(/minimum salary/i), '7000');
    expect(save).toBeEnabled();
  });

  it('saves the edited profile', async () => {
    const saveProfile = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.type(screen.getByLabelText(/minimum salary/i), '7000');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith({
      ...BASE, minSalaryUsd: 7000,
    }));
  });

  it('sends null, not zero, when the salary is cleared', async () => {
    const saveProfile = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith({
      ...BASE, minSalaryUsd: null,
    }));
  });

  it('adds an excluded location', async () => {
    const saveProfile = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);

    await userEvent.type(screen.getByLabelText(/excluded locations/i), 'Canada{Enter}');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith({
      ...BASE, excludedLocations: ['United States', 'Canada'],
    }));
  });

  it('renders both blocked-word lists with their help text', () => {
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);
    expect(screen.getByText('intern')).toBeInTheDocument();
    expect(screen.getByText(/Checked before the job page is downloaded/)).toBeInTheDocument();
    expect(screen.getByText(/Checked after the job page is downloaded/)).toBeInTheDocument();
  });

  it('warns that removing a word does not restore rejected postings', () => {
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);
    expect(screen.getByText(/does not bring back the postings it already rejected/)).toBeInTheDocument();
  });

  it('saves an added description word', async () => {
    const saveProfile = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);

    await userEvent.type(
      screen.getByLabelText('Blocked words — descriptions'),
      'relocation required{Enter}',
    );
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith({
      ...BASE, blockedDescriptionWords: ['relocation required'],
    }));
  });

  it('shows the server message on failure', async () => {
    vi.spyOn(api, 'saveProfile').mockRejectedValue(
      new Error('minSalaryUsd: Number must be greater than 0'),
    );
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.type(screen.getByLabelText(/minimum salary/i), '3');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('minSalaryUsd');
  });

  it('disables all field groups while a save is in flight', async () => {
    let resolveSave!: (version: number) => void;
    vi.spyOn(api, 'saveProfile').mockReturnValue(
      new Promise<number>((resolve) => { resolveSave = resolve; }),
    );
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.type(screen.getByLabelText(/minimum salary/i), '7000');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    const group = screen.getByRole('group', { name: 'Allowed employment types' });

    expect(screen.getByLabelText(/excluded locations/i)).toBeDisabled();
    within(group).getAllByRole('button').forEach((b) => expect(b).toBeDisabled());
    expect(screen.getByLabelText(/add an employment type/i)).toBeDisabled();
    expect(screen.getByLabelText(/minimum salary/i)).toBeDisabled();
    expect(screen.getByLabelText(/timezone/i)).toBeDisabled();

    resolveSave(4);

    await waitFor(() => {
      expect(screen.getByLabelText(/excluded locations/i)).toBeEnabled();
      within(group).getAllByRole('button').forEach((b) => expect(b).toBeEnabled());
      expect(screen.getByLabelText(/add an employment type/i)).toBeEnabled();
      expect(screen.getByLabelText(/minimum salary/i)).toBeEnabled();
      expect(screen.getByLabelText(/timezone/i)).toBeEnabled();
    });
  });

  it('toggles a known employment type on and off with aria-pressed', async () => {
    render(<ProfileForm initial={{ ...BASE, allowedEmploymentTypes: ['full-time'] }} version={1} onSaved={() => {}} />);

    expect(screen.getByRole('button', { name: 'full-time' })).toHaveAttribute('aria-pressed', 'true');
    const contract = screen.getByRole('button', { name: 'contract' });
    expect(contract).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(contract);
    expect(screen.getByRole('button', { name: 'contract' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('gives the employment-type toggles a real accessible group name', () => {
    // htmlFor cannot bind to a div; the group needs naming another way, or a
    // screen reader announces four bare buttons with no context.
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);
    const group = screen.getByRole('group', { name: 'Allowed employment types' });
    expect(within(group).getAllByRole('button')).toHaveLength(4);
  });

  it('keeps an employment type that is not one of the four known values', async () => {
    // ProfileSchema types these as free strings. A fixed set of toggles would
    // drop a custom value on the next save without saying so.
    const save = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={{ ...BASE, allowedEmploymentTypes: ['full-time', 'b2b'] }} version={1} onSaved={() => {}} />);

    expect(screen.getByText('b2b')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'contract' }));
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ allowedEmploymentTypes: ['full-time', 'b2b', 'contract'] }),
    ));
  });

  it('adds a custom employment type through the add input', async () => {
    // Removable-but-not-addable would be the same silent loss, moved from
    // save-time to add-time.
    const save = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);

    await userEvent.type(screen.getByLabelText(/add an employment type/i), 'b2b{Enter}');
    expect(screen.getByText('b2b')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ allowedEmploymentTypes: ['b2b'] }),
    ));
  });

  it('refuses an employment type that is already present', async () => {
    render(<ProfileForm initial={{ ...BASE, allowedEmploymentTypes: ['full-time'] }} version={1} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText(/add an employment type/i), 'full-time{Enter}');

    expect(screen.getByRole('status')).toHaveTextContent(/already/i);
    expect(screen.getAllByText('full-time')).toHaveLength(1);
  });

  it('shows the one-way-door warning about removing a blocked word', () => {
    render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);
    expect(screen.getByText('ONE-WAY DOOR')).toBeInTheDocument();
    expect(screen.getByText(/Removing a blocked word does not bring back the postings it already rejected/))
      .toBeInTheDocument();
  });

  it('offers no salary floor by default and sends null for a blank field', async () => {
    const save = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={{ ...BASE, minSalaryUsd: 70000 }} version={1} onSaved={() => {}} />);

    const salary = screen.getByLabelText(/minimum salary/i);
    expect(salary).toHaveAttribute('placeholder', 'No minimum');
    await userEvent.clear(salary);
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    // Blank means no floor, which is null — not 0, which ProfileSchema rejects.
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ minSalaryUsd: null })));
  });
});
