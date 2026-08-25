import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileForm } from '../src/components/ProfileForm';
import * as api from '../src/api/settings';

const PROFILE = {
  excludedLocations: ['United States'],
  allowedEmploymentTypes: ['full-time'],
  minSalaryUsd: 5000,
  timezone: 'Europe/Kyiv',
};

beforeEach(() => vi.restoreAllMocks());

describe('ProfileForm', () => {
  it('renders the current profile', () => {
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);
    expect(screen.getByText('United States')).toBeInTheDocument();
    expect(screen.getByLabelText(/minimum salary/i)).toHaveValue(5000);
    expect(screen.getByLabelText(/timezone/i)).toHaveValue('Europe/Kyiv');
  });

  it('disables Save until something changes', async () => {
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);
    const save = screen.getByRole('button', { name: /save profile/i });
    expect(save).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.type(screen.getByLabelText(/minimum salary/i), '7000');
    expect(save).toBeEnabled();
  });

  it('saves the edited profile', async () => {
    const saveProfile = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.type(screen.getByLabelText(/minimum salary/i), '7000');
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith({
      ...PROFILE, minSalaryUsd: 7000,
    }));
  });

  it('sends null, not zero, when the salary is cleared', async () => {
    const saveProfile = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith({
      ...PROFILE, minSalaryUsd: null,
    }));
  });

  it('adds an excluded location', async () => {
    const saveProfile = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);

    await userEvent.type(screen.getByLabelText(/excluded locations/i), 'Canada{Enter}');
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith({
      ...PROFILE, excludedLocations: ['United States', 'Canada'],
    }));
  });

  it('shows the server message on failure', async () => {
    vi.spyOn(api, 'saveProfile').mockRejectedValue(
      new Error('minSalaryUsd: Number must be greater than 0'),
    );
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.type(screen.getByLabelText(/minimum salary/i), '3');
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('minSalaryUsd');
  });
});
