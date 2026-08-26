import type { ReactNode } from 'react';

export interface SectionState {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

interface Props {
  id: string;
  title: string;
  blurb: string;
  version: number;
  state: SectionState;
  /**
   * Absent means the section has nothing to save. Sources is the only such
   * section: each row write is its own request and none of them bumps the
   * scoring version, so a Save button there would be a lie.
   */
  onSave?: () => void;
  /** Only for a section without onSave: why it has no Save button. */
  note?: string;
  /**
   * When present, Save is disabled regardless of dirty/saving and this
   * reason prints beside the button — the spec's "disabled state, never
   * silent": a disabled button must never appear with no explanation.
   * Distinct from `note`, which sits above the rule for a section with no
   * Save button at all (Sources); this sits beside a Save button that
   * exists but currently cannot be clicked.
   */
  disabledReason?: string | null;
  children: ReactNode;
}

export function SettingsSection({
  id, title, blurb, version, state, onSave, note, disabledReason, children,
}: Props) {
  const { dirty, saving, saved, error } = state;
  const blocked = Boolean(disabledReason);

  return (
    <section className="settings-section" aria-labelledby={`${id}-title`}>
      <div className="settings-section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <p className="settings-section-blurb">{blurb}</p>

        {onSave && dirty && !saving && (
          <span className="tag tag-accent-2">● Unsaved</span>
        )}
        {onSave && saved && !dirty && !saving && (
          <span className="tag tag-accent">✓ Saved · v{version}</span>
        )}
        {onSave && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || saving || blocked}
            onClick={onSave}
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        )}
      </div>

      {note && <p className="settings-section-note">{note}</p>}
      {/* Never a disabled button with no explanation — same idiom as
          SourceForm's gated submit ("Still needed: …"). */}
      {blocked && <p className="settings-section-note">{disabledReason}</p>}

      <div className="settings-section-rule" />

      {error && (
        <div role="alert" className="settings-section-error">
          <strong>Save failed.</strong> {error} Nothing was written and your edits
          are still here — try again.
        </div>
      )}

      {children}
    </section>
  );
}
