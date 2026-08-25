import { useEffect, useState } from 'react';
import { saveRubric } from '../api/settings';
import { useSave } from '../hooks/useSave';
import type { RubricWeights } from '../api/types';

const DIMENSIONS: (keyof RubricWeights)[] = [
  'coreStack', 'seniority', 'domain', 'logistics', 'growth',
];

interface Props {
  initialBody: string;
  initialWeights: RubricWeights;
  onSaved: () => void;
}

export function RubricEditor({ initialBody, initialWeights, onSaved }: Props) {
  const [body, setBody] = useState(initialBody);
  const [weights, setWeights] = useState<RubricWeights>(initialWeights);

  useEffect(() => { setBody(initialBody); }, [initialBody]);
  useEffect(() => { setWeights(initialWeights); }, [initialWeights]);

  const save = useSave<{ body: string; weights: RubricWeights }>(
    (v) => saveRubric(v.body, v.weights),
  );

  const sum = DIMENSIONS.reduce((a, k) => a + weights[k], 0);
  const allZero = sum === 0;
  const dirty = body !== initialBody
    || JSON.stringify(weights) !== JSON.stringify(initialWeights);

  return (
    <section className="settings-section">
      <h2>Rubric</h2>

      <label htmlFor="rubric">Rubric prose</label>
      <textarea
        id="rubric"
        rows={14}
        value={body}
        disabled={save.saving}
        onChange={(e) => setBody(e.target.value)}
      />

      {/* Weights are normalised by their actual sum, so they need not total
          100 — the percentage beside each is what the score actually uses. */}
      <div className="weights">
        {DIMENSIONS.map((key) => (
          <div className="field weight" key={key}>
            <label htmlFor={`w-${key}`}>{key}</label>
            <input
              id={`w-${key}`} type="number" min={0} max={1000}
              value={weights[key]}
              disabled={save.saving}
              onChange={(e) => setWeights((w) => ({
                ...w, [key]: e.target.value === '' ? 0 : Number(e.target.value),
              }))}
            />
            <span className="pct" data-testid={`pct-${key}`}>
              {allZero ? '—' : `${Math.round((weights[key] / sum) * 100)}%`}
            </span>
          </div>
        ))}
      </div>

      {allZero && (
        <p className="state">At least one weight must be above zero.</p>
      )}

      <div className="settings-actions">
        <button
          type="button"
          disabled={!dirty || allZero || save.saving}
          onClick={async () => { if (await save.run({ body, weights })) onSaved(); }}
        >
          {save.saving ? 'Saving…' : 'Save rubric'}
        </button>
        {save.error && <span className="state" role="alert">{save.error}</span>}
        {save.saved && !dirty && <span className="state">Saved</span>}
      </div>
    </section>
  );
}
