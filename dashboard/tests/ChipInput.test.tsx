import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipInput } from '../src/components/ChipInput';

describe('ChipInput', () => {
  it('renders one chip per value', () => {
    render(<ChipInput id="x" label="Excluded" value={['US', 'India']} onChange={() => {}} />);
    expect(screen.getByText('US')).toBeInTheDocument();
    expect(screen.getByText('India')).toBeInTheDocument();
  });

  it('adds a value on Enter and clears the field', async () => {
    const onChange = vi.fn();
    render(<ChipInput id="x" label="Excluded" value={[]} onChange={onChange} />);

    const input = screen.getByLabelText('Excluded');
    await userEvent.type(input, 'Poland{Enter}');

    expect(onChange).toHaveBeenCalledWith(['Poland']);
    expect(input).toHaveValue('');
  });

  it('trims whitespace and ignores an empty entry', async () => {
    const onChange = vi.fn();
    render(<ChipInput id="x" label="Excluded" value={[]} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText('Excluded'), '   {Enter}');
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Excluded'), '  Berlin  {Enter}');
    expect(onChange).toHaveBeenCalledWith(['Berlin']);
  });

  it('refuses a duplicate, keeps the typed text, and says why', async () => {
    const onChange = vi.fn();
    render(<ChipInput id="x" label="Excluded" value={['US']} onChange={onChange} />);
    const input = screen.getByLabelText('Excluded');
    await userEvent.type(input, 'US{Enter}');

    expect(onChange).not.toHaveBeenCalled();
    // Clearing the field before the duplicate check made the rejection look
    // like silent data loss: text gone, no chip, no explanation.
    expect(input).toHaveValue('US');
    expect(screen.getByRole('status')).toHaveTextContent(/already in the list/i);
  });

  it('drops the duplicate hint once the user edits the field again', async () => {
    const onChange = vi.fn();
    render(<ChipInput id="x" label="Excluded" value={['US']} onChange={onChange} />);
    const input = screen.getByLabelText('Excluded');

    await userEvent.type(input, 'US{Enter}');
    expect(screen.getByRole('status')).toBeInTheDocument();

    await userEvent.type(input, 'A');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await userEvent.type(input, '{Enter}');
    expect(onChange).toHaveBeenCalledWith(['US', 'USA']);
    expect(input).toHaveValue('');
  });

  it('removes a chip', async () => {
    const onChange = vi.fn();
    render(<ChipInput id="x" label="Excluded" value={['US', 'India']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /remove us/i }));
    expect(onChange).toHaveBeenCalledWith(['India']);
  });

  it('does not submit a surrounding form on Enter', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ChipInput id="x" label="Excluded" value={[]} onChange={() => {}} />
      </form>,
    );
    await userEvent.type(screen.getByLabelText('Excluded'), 'Kyiv{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables the input and remove buttons when disabled', () => {
    render(
      <ChipInput id="x" label="Excluded" value={['US', 'India']} onChange={() => {}} disabled />,
    );
    expect(screen.getByLabelText('Excluded')).toBeDisabled();
    expect(screen.getByRole('button', { name: /remove us/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /remove india/i })).toBeDisabled();
  });

  it('renders help text associated with the input', () => {
    render(<ChipInput id="w" label="Words" value={[]} onChange={() => {}} help="Type a word and press Enter." />);
    expect(screen.getByText('Type a word and press Enter.')).toBeInTheDocument();
  });
});
