import { useEffect, useState } from 'react';
import { saveRubric } from '../api/settings';
import { useSave } from '../hooks/useSave';
import { SettingsSection } from './SettingsSection';
import type { RubricWeights } from '../api/types';

const DIMENSIONS: [keyof RubricWeights, string][] = [
  ['coreStack', 'Core stack'],
  ['seniority', 'Seniority'],
  ['domain', 'Domain'],
  ['logistics', 'Logistics'],
  ['growth', 'Growth'],
];

interface Props {
  initialBody: string;
  initialWeights: RubricWeights;
  version: number;
  onSaved: () => void;
}

export function RubricEditor({ initialBody, initialWeights, version, onSaved }: Props) {
  const [body, setBody] = useState(initialBody);
  const [weights, setWeights] = useState<RubricWeights>(initialWeights);

  // `initialBody` is a string, so identity is value. `initialWeights` is an
  // object rebuilt by every /api/settings fetch, so it must be compared by
  // value — otherwise a save in a sibling section triggers a reload that
  // silently resets unsaved weight edits here.
  const initialWeightsKey = JSON.stringify(initialWeights);

  useEffect(() => { setBody(initialBody); }, [initialBody]);
  useEffect(() => { setWeights(initialWeights); },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the
    // serialised value on purpose; see above.
    [initialWeightsKey]);

  const save = useSave<{ body: string; weights: RubricWeights }>(
    (v) => saveRubric(v.body, v.weights),
  );

  const sum = DIMENSIONS.reduce((a, [k]) => a + weights[k], 0);
  const allZero = sum === 0;
  const dirty = body !== initialBody
    || JSON.stringify(weights) !== initialWeightsKey;

  return (
    <SettingsSection
      id="rubric" title="Rubric & weights" blurb="How the model is told to judge."
      version={version}
      state={{ dirty, saving: save.saving, saved: save.saved, error: save.error }}
      onSave={async () => {
        // RubricWeightsSchema refuses all-zero weights — dividing by zero would
        // store NaN as a total. Stop here rather than spending a round trip.
        if (allZero) return;
        if (await save.run({ body, weights })) onSaved();
      }}
    >
      <div className="settings-section-body rubric-grid">
        <div className="rubric-body">
          <div className="field">
            <label htmlFor="rubric">Scoring instructions given to the model</label>
            <textarea
              id="rubric" className="input rubric-area"
              value={body} spellCheck={false} disabled={save.saving}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>

        <div className="rubric-weights">
          {/* The sum is the denominator, not 100 — so the share beside each
              number is the only honest reading of "35". */}
          <p className="rubric-weights-head">
            Weights — normalised by their sum ({sum}), so only the ratios matter
          </p>
          {DIMENSIONS.map(([key, label]) => {
            const pct = sum === 0 ? 0 : Math.round((weights[key] / sum) * 100);
            return (
              <div className="rubric-weight" key={key}>
                <label htmlFor={`w-${key}`}>{label}</label>
                {/* step={1} so the browser rejects 3.5 in the field rather than
                    letting RubricWeightsSchema.int() turn it into a 400. */}
                <input
                  id={`w-${key}`} className="input" type="number" min={0} max={1000} step={1}
                  value={weights[key]} disabled={save.saving}
                  onChange={(e) => setWeights((w) => ({
                    ...w, [key]: e.target.value === '' ? 0 : Number(e.target.value),
                  }))}
                />
                <div className="rubric-bar"><div style={{ width: `${pct}%` }} /></div>
                <div className="rubric-share" data-testid={`pct-${key}`}>
                  {allZero ? '—' : `${pct}%`}
                </div>
              </div>
            );
          })}
          {allZero && (
            <p role="alert" className="rubric-zero">
              All weights are zero — the rubric would score nothing. Set at least
              one above zero.
            </p>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
