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

  it('refuses a duplicate', async () => {
    const onChange = vi.fn();
    render(<ChipInput id="x" label="Excluded" value={['US']} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Excluded'), 'US{Enter}');
    expect(onChange).not.toHaveBeenCalled();
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
});
