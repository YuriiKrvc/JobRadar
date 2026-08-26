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
  render(<SourceForm formTitle="New source" submitLabel="Add source" saving={false} error={null} onSubmit={onSubmit} />);

  await userEvent.type(screen.getByLabelText('Name'), 'Acme');
  await userEvent.type(screen.getByLabelText('Listing URL'), 'https://acme.com/careers');
  await userEvent.type(screen.getByLabelText('Item'), 'li.opening');
  await userEvent.type(screen.getByLabelText('Link'), 'a.t');
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
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save" saving={false} error={null} onSubmit={onSubmit} />);
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSubmit).toHaveBeenCalledWith(EXISTING);
});

it('omits an optional selector cleared by the user, not just one left blank', async () => {
  // EXISTING.selectors.detail starts populated ('div.jd'). Clearing it must
  // remove the key entirely: sending '' would trip the backend's
  // SelectorsSchema.min(1) and turn a routine re-tune into a 400.
  const onSubmit = vi.fn();
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save" saving={false} error={null} onSubmit={onSubmit} />);
  await userEvent.clear(screen.getByLabelText('Description container'));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(onSubmit).toHaveBeenCalledWith({
    ...EXISTING,
    selectors: { item: 'li.opening', link: 'a.t' },
  });
  const [submitted] = onSubmit.mock.calls.at(-1)!;
  expect(submitted.selectors).not.toHaveProperty('detail');
});

it('pre-fills every field from initial', () => {
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save" saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.getByLabelText('Name')).toHaveValue('Acme');
  expect(screen.getByLabelText('Item')).toHaveValue('li.opening');
  expect(screen.getByLabelText('Description container')).toHaveValue('div.jd');
  expect(screen.getByText('intern')).toBeInTheDocument();
});

it('disables the submit button until name, url, item and link are all filled', async () => {
  render(<SourceForm formTitle="New source" submitLabel="Add source" saving={false} error={null} onSubmit={() => {}} />);
  const button = screen.getByRole('button', { name: 'Add source' });
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Name'), 'Acme');
  expect(button).toBeDisabled();
});

it('shows the error and keeps the typed values', () => {
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save" saving={false} error="Another source already uses that name" onSubmit={() => {}} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Another source already uses that name');
  expect(screen.getByLabelText('Name')).toHaveValue('Acme');
});

it('renders a cancel button only when onCancel is given', () => {
  const { rerender } = render(<SourceForm formTitle="New source" submitLabel="Add" saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  rerender(<SourceForm formTitle="New source" submitLabel="Save" saving={false} error={null} onSubmit={() => {}} onCancel={() => {}} />);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});

it('shows the four required fields and hides the six optional ones behind one line', async () => {
  render(<SourceForm formTitle="New source" submitLabel="Add source" saving={false} error={null} onSubmit={() => {}} />);

  expect(screen.getByLabelText('Name')).toBeInTheDocument();
  expect(screen.getByLabelText('Item')).toBeInTheDocument();
  expect(screen.queryByLabelText('Description container')).toBeNull();

  // The disclosure names all six, so it hides the inputs and never the fact
  // that the fields exist.
  const line = screen.getByRole('button', {
    name: 'Six optional selectors — title, company, location, employment type, description, description container',
  });
  expect(line).toHaveAttribute('aria-expanded', 'false');

  await userEvent.click(line);
  expect(screen.getByLabelText('Description container')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hide the six optional selectors' }))
    .toHaveAttribute('aria-expanded', 'true');
});

it('opens the optional selectors when an existing source already uses one', () => {
  // Editing a board whose detail selector is set must not hide the field that
  // needs repairing behind a line the user has to guess at.
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save this source"
    saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.getByLabelText('Description container')).toHaveValue('div.jd');
});

it('names what is still missing beside the disabled submit', async () => {
  render(<SourceForm formTitle="New source" submitLabel="Add source" saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.getByText('Still needed: Name, Listing URL, Item, Link')).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Name'), 'Acme');
  await userEvent.type(screen.getByLabelText('Listing URL'), 'https://acme.com/careers');
  expect(screen.getByText('Still needed: Item, Link')).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Item'), 'li.opening');
  await userEvent.type(screen.getByLabelText('Link'), 'a.t');
  expect(screen.queryByText(/Still needed/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled();
});

it('marks the four required inputs aria-required, and the optional ones not', async () => {
  render(<SourceForm formTitle="New source" submitLabel="Add source" saving={false} error={null} onSubmit={() => {}} />);

  for (const label of ['Name', 'Listing URL', 'Item', 'Link']) {
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-required', 'true');
  }

  await userEvent.click(screen.getByRole('button', { name: /Six optional selectors/ }));
  expect(screen.getByLabelText('Description container')).not.toHaveAttribute('aria-required', 'true');
});

it('marks the colliding field when the server reports a duplicate name', () => {
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save this source"
    saving={false} error="Another source already uses that name" onSubmit={() => {}} />);

  expect(screen.getByRole('alert')).toHaveTextContent('Another source already uses that name');
  // Three carriers, never colour alone: aria-invalid, a magenta border, a sentence.
  expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Listing URL')).not.toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Name')).toHaveValue('Acme');
});

it('marks the URL field when the server reports a duplicate listing URL', () => {
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save this source"
    saving={false} error="Another source already uses that URL" onSubmit={() => {}} />);
  expect(screen.getByLabelText('Listing URL')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true');
});

it('reassures the user that nothing was saved and their values are still there', () => {
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save this source"
    saving={false} error="Another source already uses that name" onSubmit={() => {}} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    /Nothing was saved.*your values are still here/i,
  );
});

it('does not mark any field invalid for an unrelated error mentioning "url"', () => {
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save this source"
    saving={false} error="Failed to fetch: check your url and try again" onSubmit={() => {}} />);
  expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Listing URL')).not.toHaveAttribute('aria-invalid', 'true');
});

it('says which page each selector is read against', async () => {
  render(<SourceForm formTitle="New source" submitLabel="Add source" saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.getByText(/Selects each posting block on the listing page/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Six optional selectors/ }));
  expect(screen.getByText(/Read on the posting’s own page, not the listing/)).toBeInTheDocument();
});
