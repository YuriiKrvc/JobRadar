import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourceForm } from '../src/components/SourceForm';

const EXISTING = {
  name: 'Acme', url: 'https://acme.com/careers',
  selectors: { item: 'li.opening', link: 'a.t', detail: 'div.jd' },
  blockedTitleWords: ['intern'], blockedDescriptionWords: [],
};

it('submits a minimal source with only the required selectors', async () => {
  const onSubmit = vi.fn();
  render(<SourceForm submitLabel="Add source" saving={false} error={null} onSubmit={onSubmit} />);

  await userEvent.type(screen.getByLabelText('Name'), 'Acme');
  await userEvent.type(screen.getByLabelText('Listing URL'), 'https://acme.com/careers');
  await userEvent.type(screen.getByLabelText('Item (required)'), 'li.opening');
  await userEvent.type(screen.getByLabelText('Link (required)'), 'a.t');
  await userEvent.click(screen.getByRole('button', { name: 'Add source' }));

  expect(onSubmit).toHaveBeenCalledWith({
    name: 'Acme', url: 'https://acme.com/careers',
    selectors: { item: 'li.opening', link: 'a.t' },
    blockedTitleWords: [], blockedDescriptionWords: [],
  });
});

it('omits blank optional selectors rather than sending empty strings', async () => {
  // The backend's SelectorsSchema rejects '' via .min(1), so a blank field must
  // be absent, not empty.
  const onSubmit = vi.fn();
  render(<SourceForm initial={EXISTING} submitLabel="Save" saving={false} error={null} onSubmit={onSubmit} />);
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSubmit).toHaveBeenCalledWith(EXISTING);
});

it('pre-fills every field from initial', () => {
  render(<SourceForm initial={EXISTING} submitLabel="Save" saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.getByLabelText('Name')).toHaveValue('Acme');
  expect(screen.getByLabelText('Item (required)')).toHaveValue('li.opening');
  expect(screen.getByLabelText('Description container (posting page)')).toHaveValue('div.jd');
  expect(screen.getByText('intern')).toBeInTheDocument();
});

it('disables the submit button until name, url, item and link are all filled', async () => {
  render(<SourceForm submitLabel="Add source" saving={false} error={null} onSubmit={() => {}} />);
  const button = screen.getByRole('button', { name: 'Add source' });
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Name'), 'Acme');
  expect(button).toBeDisabled();
});

it('shows the error and keeps the typed values', () => {
  render(<SourceForm initial={EXISTING} submitLabel="Save" saving={false} error="Another source already uses that name" onSubmit={() => {}} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Another source already uses that name');
  expect(screen.getByLabelText('Name')).toHaveValue('Acme');
});

it('renders a cancel button only when onCancel is given', () => {
  const { rerender } = render(<SourceForm submitLabel="Add" saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  rerender(<SourceForm submitLabel="Save" saving={false} error={null} onSubmit={() => {}} onCancel={() => {}} />);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});
