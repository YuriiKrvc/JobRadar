import { useState } from 'react';
import { ChipInput } from './ChipInput';
import type { Selectors, SourceInput } from '../api/types';

interface Props {
  initial?: SourceInput;
  submitLabel: string;
  saving: boolean;
  error: string | null;
  onSubmit: (input: SourceInput) => void;
  onCancel?: () => void;
}

const EMPTY: SourceInput = {
  name: '', url: '', selectors: { item: '', link: '' },
  blockedTitleWords: [], blockedDescriptionWords: [],
};

// Labelled and ordered as the user reads the page: the two required structural
// selectors first, then the fields they can leave to the fallbacks.
const SELECTOR_FIELDS: { key: keyof Selectors; label: string; help: string }[] = [
  { key: 'item', label: 'Item (required)', help: 'Each posting block on the listing page, e.g. li.opening' },
  { key: 'link', label: 'Link (required)', help: 'The link inside a block whose address is the posting, e.g. a.job-title' },
  { key: 'title', label: 'Title', help: 'Leave empty to use the link text, which is usually right.' },
  { key: 'company', label: 'Company', help: 'Leave empty to use the source name above.' },
  { key: 'location', label: 'Location', help: 'Optional. Feeds the excluded-locations filter.' },
  { key: 'employmentType', label: 'Employment type', help: 'Optional. Feeds the allowed-employment-types filter.' },
  { key: 'description', label: 'Snippet on the listing page', help: 'Optional. A short summary if the board shows one.' },
  {
    key: 'detail', label: 'Description container (posting page)',
    help: 'Strongly recommended. Left empty, the whole posting page becomes the '
      + 'description — navigation, footers and any salary widget included. A '
      + 'board\'s own salary filter can then trip the minimum-salary rule and get '
      + 'good postings rejected.',
  },
];

export function SourceForm({ initial, submitLabel, saving, error, onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState<SourceInput>(initial ?? EMPTY);

  function setSelector(key: keyof Selectors, value: string) {
    setDraft((d) => ({ ...d, selectors: { ...d.selectors, [key]: value } }));
  }

  const complete = draft.name.trim() !== '' && draft.url.trim() !== ''
    && draft.selectors.item.trim() !== '' && draft.selectors.link.trim() !== '';

  function submit() {
    // A blank optional selector must be absent, not '': the backend's
    // SelectorsSchema requires min(1) on every value it receives.
    const selectors = Object.fromEntries(
      Object.entries(draft.selectors).filter(([, v]) => (v ?? '').trim() !== ''),
    ) as Selectors;
    onSubmit({ ...draft, name: draft.name.trim(), url: draft.url.trim(), selectors });
  }

  return (
    <div className="source-form">
      <div className="field">
        <label htmlFor="source-name">Name</label>
        <p className="field-help">
          The company or board. Shown on every posting from this source and in the
          source filter, so make it recognisable. Must be unique.
        </p>
        <input id="source-name" value={draft.name} disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
      </div>

      <div className="field">
        <label htmlFor="source-url">Listing URL</label>
        <p className="field-help">
          The page that lists the jobs, with any filters you want already applied.
          Fetched every run to spot new postings.
        </p>
        <input id="source-url" value={draft.url} disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))} />
      </div>

      <fieldset className="selectors">
        <legend>Selectors</legend>
        <p className="field-help">
          CSS selectors read from the listing page's HTML. Only static HTML is
          parsed — a board that renders its jobs with JavaScript will find nothing,
          whatever you put here.
        </p>
        {SELECTOR_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`sel-${f.key}`}>{f.label}</label>
            <p className="field-help">{f.help}</p>
            <input id={`sel-${f.key}`} value={draft.selectors[f.key] ?? ''} disabled={saving}
              onChange={(e) => setSelector(f.key, e.target.value)} />
          </div>
        ))}
      </fieldset>

      <ChipInput
        id="source-title-words" label="Blocked words — titles (this source)"
        help="Extra blocked title words for this board only, added to the global list in Profile. Type a word and press Enter."
        value={draft.blockedTitleWords} disabled={saving}
        onChange={(v) => setDraft((d) => ({ ...d, blockedTitleWords: v }))}
      />

      <ChipInput
        id="source-desc-words" label="Blocked words — descriptions (this source)"
        help="Extra blocked description words for this board only, added to the global list in Profile. Type a word and press Enter."
        value={draft.blockedDescriptionWords} disabled={saving}
        onChange={(v) => setDraft((d) => ({ ...d, blockedDescriptionWords: v }))}
      />

      <div className="settings-actions">
        <button type="button" disabled={!complete || saving} onClick={submit}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
        )}
        {error && <span className="state" role="alert">{error}</span>}
      </div>
    </div>
  );
}
