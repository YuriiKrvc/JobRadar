import type { ReactNode } from 'react';
import css from './settings.module.css';
import s from './SettingsSection.module.css';

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
  /** Disables Save and prints why. Never a disabled control with no reason. */
  disabledReason?: string | null;
  children: ReactNode;
}

export function SettingsSection(
  { id, title, blurb, version, state, onSave, note, disabledReason, children }: Props,
) {
  const { dirty, saving, saved, error } = state;
  const blocked = Boolean(disabledReason);

  return (
    <section className={s.section} aria-labelledby={`${id}-title`}>
      <div className={css.head}>
        <h2 id={`${id}-title`} className={s.title}>{title}</h2>
        <p className={s.blurb}>{blurb}</p>

        {onSave && dirty && !saving && (
          <span className={`${css.tag} ${css.tagAccent2}`}>● Unsaved</span>
        )}
        {onSave && saved && !dirty && !saving && (
          <span className={`${css.tag} ${css.tagAccent}`}>✓ Saved · v{version}</span>
        )}
        {onSave && (
          <button
            type="button"
            className={`${css.button} ${css.buttonPrimary} ${s.save}`}
            disabled={!dirty || saving || blocked}
            onClick={onSave}
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        )}
      </div>

      {note && <p className={s.note}>{note}</p>}
      {blocked && <p className={s.note}>{disabledReason}</p>}

      <div className={s.rule} />

      {error && (
        <div role="alert" className={`${css.error} ${s.error}`}>
          <strong>Save failed.</strong> {error} Nothing was written and your edits
          are still here — try again.
        </div>
      )}

      <div className={s.body}>{children}</div>
    </section>
  );
}
