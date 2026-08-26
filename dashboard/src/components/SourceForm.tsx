import { useState } from 'react';
import { ChipInput } from './ChipInput';
import type { Selectors, SourceInput } from '../api/types';

interface Props {
  initial?: SourceInput;
  formTitle: string;
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

interface FieldDef {
  key: 'name' | 'url' | keyof Selectors;
  label: string;
  required: boolean;
  mono: boolean;
  width: string;
  placeholder: string;
  /** Two clauses: what it matches, and what happens if it is left blank. */
  help: string;
}

const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', required: true, mono: false, width: '190px', placeholder: 'Acme',
    help: 'Unique. Becomes the posting’s source label and the name in the health panel.' },
  { key: 'url', label: 'Listing URL', required: true, mono: false, width: '330px', placeholder: 'https://acme.com/careers',
    help: 'Unique. The page that lists the openings — fetched every tick.' },
  { key: 'item', label: 'Item', required: true, mono: true, width: '250px', placeholder: 'li.job-post',
    help: 'Selects each posting block on the listing page. Everything below is read inside one block.' },
  { key: 'link', label: 'Link', required: true, mono: true, width: '250px', placeholder: 'a[href*="/jobs/"]',
    help: 'The anchor inside the block whose href is the posting URL.' },
  { key: 'title', label: 'Title', required: false, mono: true, width: '230px', placeholder: 'h3',
    help: 'Read inside the item block. Absent: the link’s own text is used.' },
  { key: 'company', label: 'Company', required: false, mono: true, width: '230px', placeholder: '.company',
    help: 'Read inside the item block. Absent: the source’s Name is used.' },
  { key: 'location', label: 'Location', required: false, mono: true, width: '230px', placeholder: '.location',
    help: 'Read inside the item block. Absent: the posting shows no location.' },
  { key: 'employmentType', label: 'Employment type', required: false, mono: true, width: '230px', placeholder: '.job-type',
    help: 'Feeds the employment-type hard filter. Absent: that filter cannot reject this source.' },
  { key: 'description', label: 'Description', required: false, mono: true, width: '230px', placeholder: '.job-summary',
    help: 'Read on the listing page, if the blurb is there. Absent: the posting has no snippet until it is hydrated.' },
  // Longer than the design's one-liner on purpose: an empty value feeds the
  // whole page to the salary filter, and a board's own salary widget then
  // rejects good postings. That cost real debugging time.
  { key: 'detail', label: 'Description container', required: false, mono: true, width: '270px', placeholder: 'main .job-body',
    help: 'Read on the posting’s own page, not the listing. Absent: the whole page is used — navigation, footers and any salary widget included, and a board’s own salary filter can then trip the minimum-salary rule and reject good postings.' },
];

const REQUIRED = FIELDS.filter((f) => f.required);
const OPTIONAL = FIELDS.filter((f) => !f.required);

const OPTIONAL_LABEL = 'Six optional selectors — title, company, location, '
  + 'employment type, description, description container';

export function SourceForm({ initial, formTitle, submitLabel, saving, error, onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState<SourceInput>(initial ?? EMPTY);
  // Open from the start when an existing source already uses one of them:
  // hiding the field that needs repairing behind a line is exactly the case
  // the disclosure must not create.
  const [optionalOpen, setOptionalOpen] = useState(
    OPTIONAL.some((f) => ((initial?.selectors[f.key as keyof Selectors] ?? '') !== '')),
  );

  function valueOf(f: FieldDef): string {
    if (f.key === 'name') return draft.name;
    if (f.key === 'url') return draft.url;
    return draft.selectors[f.key as keyof Selectors] ?? '';
  }

  function setValue(f: FieldDef, value: string) {
    if (f.key === 'name') return setDraft((d) => ({ ...d, name: value }));
    if (f.key === 'url') return setDraft((d) => ({ ...d, url: value }));
    setDraft((d) => ({ ...d, selectors: { ...d.selectors, [f.key]: value } }));
  }

  // The backend distinguishes the two unique constraints by constraint_name and
  // says which one collided; map that sentence back onto the field so the
  // failure is marked where it happened, not only at the top of the form.
  const collided = error === null ? null
    : /\bname\b/i.test(error) ? 'name'
    : /\burl\b/i.test(error) ? 'url'
    : null;

  const missing = REQUIRED.filter((f) => valueOf(f).trim() === '').map((f) => f.label);

  function submit() {
    // A blank optional selector must be absent, not '': the backend's
    // SelectorsSchema requires min(1) on every value it receives.
    const selectors = Object.fromEntries(
      Object.entries(draft.selectors).filter(([, v]) => (v ?? '').trim() !== ''),
    ) as Selectors;
    onSubmit({ ...draft, name: draft.name.trim(), url: draft.url.trim(), selectors });
  }

  function renderField(f: FieldDef) {
    const invalid = collided === f.key;
    return (
      <div className={f.required ? 'field source-field required' : 'field source-field'} key={f.key} style={{ width: f.width }}>
        <label htmlFor={`src-${f.key}`}>{f.label}</label>
        <input
          id={`src-${f.key}`}
          className={f.mono ? 'input input-mono' : 'input'}
          value={valueOf(f)}
          placeholder={f.placeholder}
          aria-invalid={invalid || undefined}
          aria-required={f.required || undefined}
          disabled={saving}
          onChange={(e) => setValue(f, e.target.value)}
        />
        <p className="source-field-help">{f.help}</p>
      </div>
    );
  }

  return (
    <div className="source-form">
      <div className="source-form-head">
        <h4>{formTitle}</h4>
        <p>
          Every field below except Name and Listing URL is a CSS selector, read
          against the page it names. Copy them from devtools.
        </p>
      </div>

      <h6 className="source-form-group">Required</h6>
      <div className="source-fields">{REQUIRED.map(renderField)}</div>

      <button
        type="button" className="btn-bare source-disclosure"
        aria-expanded={optionalOpen}
        onClick={() => setOptionalOpen((o) => !o)}
      >
        {optionalOpen ? 'Hide the six optional selectors' : OPTIONAL_LABEL}
      </button>

      {optionalOpen && (
        <div className="source-optional">
          <h6 className="source-form-group">Optional — each has a sensible fallback</h6>
          <div className="source-fields">{OPTIONAL.map(renderField)}</div>

          <div className="source-blocklists">
            <ChipInput
              id="source-title-words" label="Blocked words — titles, for this source only"
              value={draft.blockedTitleWords} disabled={saving}
              placeholder="Add, then Enter"
              onChange={(v) => setDraft((d) => ({ ...d, blockedTitleWords: v }))}
            />
            <ChipInput
              id="source-desc-words" label="Blocked words — descriptions, for this source only"
              value={draft.blockedDescriptionWords} disabled={saving}
              placeholder="Add, then Enter"
              onChange={(v) => setDraft((d) => ({ ...d, blockedDescriptionWords: v }))}
            />
          </div>
          <p className="source-blocklists-note">
            These are added to the global blocklists in Profile for this source —
            they never subtract from them.
          </p>
        </div>
      )}

      {error && <div role="alert" className="source-form-error">{error}</div>}

      <div className="source-form-actions">
        <button type="button" className="btn btn-primary" disabled={missing.length > 0 || saving} onClick={submit}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
        )}
        {/* Never a disabled button with no explanation. */}
        {missing.length > 0 && (
          <p className="source-form-missing">Still needed: {missing.join(', ')}</p>
        )}
      </div>
    </div>
  );
}
