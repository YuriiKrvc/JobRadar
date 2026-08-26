import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RubricEditor } from '../src/components/RubricEditor';
import * as api from '../src/api/settings';

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };
const LABELS = ['Core stack', 'Seniority', 'Domain', 'Logistics', 'Growth'];

beforeEach(() => vi.restoreAllMocks());

function setup() {
  return render(
    <RubricEditor initialBody="score it" initialWeights={WEIGHTS} version={3} onSaved={() => {}} />,
  );
}

describe('RubricEditor', () => {
  it('renders the prose and every weight', () => {
    setup();
    expect(screen.getByLabelText(/scoring instructions/i)).toHaveValue('score it');
    expect(screen.getByLabelText('Core stack')).toHaveValue(35);
    expect(screen.getByLabelText('Growth')).toHaveValue(10);
  });

  it('shows each weight as a percentage of the total', () => {
    setup();
    // 35 of 100.
    expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('35%');
    expect(screen.getByTestId('pct-growth')).toHaveTextContent('10%');
  });

  it('recomputes percentages live as a weight changes', async () => {
    setup();
    const core = screen.getByLabelText('Core stack');

    await userEvent.clear(core);
    await userEvent.type(core, '135');

    // 135 of 200.
    await waitFor(() => expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('68%'));
    expect(screen.getByTestId('pct-growth')).toHaveTextContent('5%');
  });

  it('does not require the weights to sum to 100', async () => {
    const save = vi.spyOn(api, 'saveRubric').mockResolvedValue(4);
    setup();

    await userEvent.clear(screen.getByLabelText('Core stack'));
    await userEvent.type(screen.getByLabelText('Core stack'), '70');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('score it', { ...WEIGHTS, coreStack: 70 }));
  });

  it('disables Save until something changes', async () => {
    setup();
    expect(screen.getByRole('button', { name: /^Save/ })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/scoring instructions/i), '!');
    expect(screen.getByRole('button', { name: /^Save/ })).toBeEnabled();
  });

  it('saves prose and weights together', async () => {
    const save = vi.spyOn(api, 'saveRubric').mockResolvedValue(4);
    setup();

    await userEvent.type(screen.getByLabelText(/scoring instructions/i), ' harder');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('score it harder', WEIGHTS));
  });

  it('shows the server message on failure', async () => {
    vi.spyOn(api, 'saveRubric').mockRejectedValue(
      new Error('weights: at least one weight must be above zero'),
    );
    setup();

    await userEvent.type(screen.getByLabelText(/scoring instructions/i), '!');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('above zero');
  });

  it('disables the prose textarea and every weight input while saving, then re-enables them', async () => {
    let resolveSave: (version: number) => void = () => {};
    vi.spyOn(api, 'saveRubric').mockImplementation(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
    setup();

    await userEvent.type(screen.getByLabelText(/scoring instructions/i), '!');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    expect(screen.getByLabelText(/scoring instructions/i)).toBeDisabled();
    for (const label of LABELS) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }

    resolveSave(4);

    await waitFor(() => expect(screen.getByLabelText(/scoring instructions/i)).toBeEnabled());
    for (const label of LABELS) {
      expect(screen.getByLabelText(label)).toBeEnabled();
    }
  });

  it('labels the weights in prose and shows each share of the running sum', () => {
    render(<RubricEditor initialBody="body" initialWeights={{
      coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10,
    }} version={3} onSaved={() => {}} />);

    expect(screen.getByLabelText('Core stack')).toHaveValue(35);
    expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('35%');
    expect(screen.getByText(/normalised by their sum \(100\)/)).toBeInTheDocument();
  });

  it('normalises by the actual sum, not by 100', () => {
    // 70/40/30/40/20 is the same rubric as 35/20/15/20/10: only ratios matter.
    render(<RubricEditor initialBody="body" initialWeights={{
      coreStack: 70, seniority: 40, domain: 30, logistics: 40, growth: 20,
    }} version={3} onSaved={() => {}} />);

    expect(screen.getByText(/normalised by their sum \(200\)/)).toBeInTheDocument();
    expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('35%');
    expect(screen.getByTestId('pct-growth')).toHaveTextContent('10%');
  });

  it('raises an alert for all-zero weights instead of waiting for the server', async () => {
    render(<RubricEditor initialBody="body" initialWeights={{
      coreStack: 0, seniority: 0, domain: 0, logistics: 0, growth: 0,
    }} version={3} onSaved={() => {}} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'All weights are zero — the rubric would score nothing. Set at least one above zero.',
    );
  });

  it('disables Save with its reason printed beside it when all weights are zeroed out, and never calls saveRubric', async () => {
    // Editing every weight down to 0 makes the section dirty. Previously
    // SettingsSection — which knows nothing about all-zero weights — enabled
    // Save regardless, and only an `if (allZero) return;` guard inside onSave
    // stopped the click from reaching the backend: an enabled button that
    // silently does nothing, which the spec's "disabled state, never silent"
    // contract forbids. RubricEditor now passes SettingsSection a
    // disabledReason, so the button itself is disabled and the reason is
    // printed beside it. Seed with non-zero weights so the edit itself is
    // what makes the section dirty, rather than starting from an
    // already-all-zero (and thus non-dirty) state.
    const save = vi.spyOn(api, 'saveRubric').mockResolvedValue(4);
    setup();

    for (const label of LABELS) {
      const input = screen.getByLabelText(label);
      await userEvent.clear(input);
      await userEvent.type(input, '0');
    }

    const saveButton = screen.getByRole('button', { name: /^Save/ });
    expect(saveButton).toBeDisabled();
    // The same sentence also appears in the rubric-weights column's own
    // role="alert" (a separate contract, per spec), so there are two matches
    // here — assert the reason beside the button specifically.
    const reasons = screen.getAllByText(
      'All weights are zero — the rubric would score nothing. Set at least one above zero.',
    );
    expect(reasons.some((el) => el.className === 'settings-section-note')).toBe(true);

    // Disabled buttons don't fire click handlers, but assert the outcome
    // directly rather than relying on that alone.
    await userEvent.click(saveButton);
    expect(save).not.toHaveBeenCalled();
  });
});
