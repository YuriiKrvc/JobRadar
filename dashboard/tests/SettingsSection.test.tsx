import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsSection } from '../src/components/SettingsSection';

const CLEAN = { dirty: false, saving: false, saved: false, error: null };

function renderSection(overrides: Partial<React.ComponentProps<typeof SettingsSection>> = {}) {
  return render(
    <SettingsSection
      id="cv" title="CV" blurb="The text every posting is scored against."
      version={12} state={CLEAN} onSave={() => {}} {...overrides}
    >
      <p>fields</p>
    </SettingsSection>,
  );
}

it('names its region by its heading so one section can be addressed among four', () => {
  renderSection();
  const region = screen.getByRole('region', { name: 'CV' });
  expect(within(region).getByText('The text every posting is scored against.')).toBeInTheDocument();
  expect(within(region).getByText('fields')).toBeInTheDocument();
});

it('clean: the button reads Saved and is disabled, with no chip', () => {
  renderSection();
  const save = screen.getByRole('button', { name: 'Saved' });
  expect(save).toBeDisabled();
  expect(screen.queryByText(/Unsaved/)).toBeNull();
});

it('dirty: an Unsaved chip appears and the button reads Save', () => {
  renderSection({ state: { ...CLEAN, dirty: true } });
  expect(screen.getByText('● Unsaved')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

it('saving: the button reads Saving… and is disabled', () => {
  renderSection({ state: { ...CLEAN, dirty: true, saving: true } });
  const save = screen.getByRole('button', { name: 'Saving…' });
  expect(save).toBeDisabled();
  // The dirty chip must not show while the write is in flight — the section is
  // no longer waiting for the user, it is waiting for the server.
  expect(screen.queryByText('● Unsaved')).toBeNull();
});

it('saved: the chip carries the version the save produced', () => {
  renderSection({ state: { ...CLEAN, saved: true }, version: 13 });
  expect(screen.getByText('✓ Saved · v13')).toBeInTheDocument();
});

it('error: an alert says nothing was written and the edits are still here', () => {
  renderSection({ state: { ...CLEAN, dirty: true, error: 'The scoring service returned 500.' } });
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Save failed.');
  expect(alert).toHaveTextContent('The scoring service returned 500.');
  expect(alert).toHaveTextContent('Nothing was written and your edits are still here — try again.');
  // Still dirty: a failed save must leave the section savable again.
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

it('calls onSave when the button is pressed', async () => {
  const onSave = vi.fn();
  renderSection({ state: { ...CLEAN, dirty: true }, onSave });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledOnce();
});

it('without onSave there is no chip and no button, and the note explains why', () => {
  renderSection({
    onSave: undefined,
    title: 'Sources',
    blurb: 'Boards polled every 30 minutes.',
    note: 'Sources save as you go and do not change the scoring version.',
    state: { ...CLEAN, dirty: true, saved: true },
  });
  const region = screen.getByRole('region', { name: 'Sources' });
  expect(within(region).queryByRole('button')).toBeNull();
  expect(within(region).queryByText('● Unsaved')).toBeNull();
  expect(within(region).getByText('Sources save as you go and do not change the scoring version.'))
    .toBeInTheDocument();
});
