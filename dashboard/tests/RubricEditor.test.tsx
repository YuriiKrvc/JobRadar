import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RubricEditor } from '../src/components/RubricEditor';
import * as api from '../src/api/settings';

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };

beforeEach(() => vi.restoreAllMocks());

function setup() {
  return render(
    <RubricEditor initialBody="score it" initialWeights={WEIGHTS} onSaved={() => {}} />,
  );
}

describe('RubricEditor', () => {
  it('renders the prose and every weight', () => {
    setup();
    expect(screen.getByLabelText(/rubric/i)).toHaveValue('score it');
    expect(screen.getByLabelText(/coreStack/i)).toHaveValue(35);
    expect(screen.getByLabelText(/growth/i)).toHaveValue(10);
  });

  it('shows each weight as a percentage of the total', () => {
    setup();
    // 35 of 100.
    expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('35%');
    expect(screen.getByTestId('pct-growth')).toHaveTextContent('10%');
  });

  it('recomputes percentages live as a weight changes', async () => {
    setup();
    const core = screen.getByLabelText(/coreStack/i);

    await userEvent.clear(core);
    await userEvent.type(core, '135');

    // 135 of 200.
    await waitFor(() => expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('68%'));
    expect(screen.getByTestId('pct-growth')).toHaveTextContent('5%');
  });

  it('does not require the weights to sum to 100', async () => {
    const save = vi.spyOn(api, 'saveRubric').mockResolvedValue(4);
    setup();

    await userEvent.clear(screen.getByLabelText(/coreStack/i));
    await userEvent.type(screen.getByLabelText(/coreStack/i), '70');
    await userEvent.click(screen.getByRole('button', { name: /save rubric/i }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('score it', { ...WEIGHTS, coreStack: 70 }));
  });

  it('disables Save when every weight is zero', async () => {
    setup();
    for (const key of ['coreStack', 'seniority', 'domain', 'logistics', 'growth']) {
      const input = screen.getByLabelText(new RegExp(key, 'i'));
      await userEvent.clear(input);
      await userEvent.type(input, '0');
    }
    expect(screen.getByRole('button', { name: /save rubric/i })).toBeDisabled();
    expect(screen.getByText(/at least one weight/i)).toBeInTheDocument();
  });

  it('disables Save until something changes', async () => {
    setup();
    expect(screen.getByRole('button', { name: /save rubric/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/rubric/i), '!');
    expect(screen.getByRole('button', { name: /save rubric/i })).toBeEnabled();
  });

  it('saves prose and weights together', async () => {
    const save = vi.spyOn(api, 'saveRubric').mockResolvedValue(4);
    setup();

    await userEvent.type(screen.getByLabelText(/rubric/i), ' harder');
    await userEvent.click(screen.getByRole('button', { name: /save rubric/i }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('score it harder', WEIGHTS));
  });

  it('shows the server message on failure', async () => {
    vi.spyOn(api, 'saveRubric').mockRejectedValue(
      new Error('weights: at least one weight must be above zero'),
    );
    setup();

    await userEvent.type(screen.getByLabelText(/rubric/i), '!');
    await userEvent.click(screen.getByRole('button', { name: /save rubric/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('above zero');
  });

  it('disables the prose textarea and every weight input while saving, then re-enables them', async () => {
    let resolveSave: (version: number) => void = () => {};
    vi.spyOn(api, 'saveRubric').mockImplementation(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
    setup();

    await userEvent.type(screen.getByLabelText(/rubric/i), '!');
    await userEvent.click(screen.getByRole('button', { name: /save rubric/i }));

    expect(screen.getByLabelText(/rubric/i)).toBeDisabled();
    for (const key of ['coreStack', 'seniority', 'domain', 'logistics', 'growth']) {
      expect(screen.getByLabelText(new RegExp(key, 'i'))).toBeDisabled();
    }

    resolveSave(4);

    await waitFor(() => expect(screen.getByLabelText(/rubric/i)).toBeEnabled());
    for (const key of ['coreStack', 'seniority', 'domain', 'logistics', 'growth']) {
      expect(screen.getByLabelText(new RegExp(key, 'i'))).toBeEnabled();
    }
  });
});
