import { Fragment, useState } from 'react';
import { addSource, deleteSource, fetchSources, toggleSource, updateSource } from '../api/settings';
import { useApi } from '../hooks/useApi';
import { useSave } from '../hooks/useSave';
import { SettingsSection } from './SettingsSection';
import { SourceForm } from './SourceForm';
import type { SourceInput, SourceRow } from '../api/types';
import css from './settings.module.css';

function toInput(r: SourceRow): SourceInput {
  return {
    name: r.name, url: r.url, selectors: r.selectors,
    blockedTitleWords: r.blockedTitleWords,
    blockedDescriptionWords: r.blockedDescriptionWords,
  };
}

interface Props {
  version: number;
}

/** 'new' is the add row; a uuid is the row being edited; null is closed. */
type Open = string | 'new' | null;

export function SourcesTable({ version }: Props) {
  const sources = useApi(() => fetchSources());
  const [open, setOpen] = useState<Open>(null);

  const add = useSave<SourceInput>(addSource);
  const edit = useSave<{ id: string; input: SourceInput }>(({ id, input }) => updateSource(id, input));
  const mutate = useSave<() => Promise<unknown>>((fn) => fn());

  // `add` and `edit` are single component-level instances shared by every row
  // and by the add form. Neither `useSave` clears its error on unmount, so a
  // failed save otherwise follows the form to whatever opens next — the blank
  // add form after "Cancel new source", or a different row's edit form. Every
  // path that moves `open` to a new target goes through this so the next form
  // always opens clean.
  function openTarget(next: Open) {
    add.reset();
    edit.reset();
    setOpen(next);
  }

  return (
    <SettingsSection
      id="sources" title="Sources" blurb="Boards polled every 30 minutes."
      version={version}
      // Sources has nothing to save: every row write is its own request, and
      // none of them bumps the scoring version.
      note="Sources save as you go and do not change the scoring version."
      state={{ dirty: false, saving: false, saved: false, error: null }}
    >
      {sources.error && <p className={css.state} role="alert">Error: {sources.error}</p>}
      {sources.data?.length === 0 && (
        <p className={css.state}>No sources configured — add one below.</p>
      )}

      <table className={css.table}>
        <thead>
          <tr>
            <th className={css.colOn}>On</th>
            <th className={css.colName}>Name</th>
            <th>Listing URL</th>
            <th className={css.colEdit} />
            <th className={css.colDelete} />
          </tr>
        </thead>
        <tbody>
          {(sources.data ?? []).map((r) => (
            <Fragment key={r.id}>
              <tr className={[r.enabled ? '' : css.rowDisabled, open === r.id ? css.rowEditing : ''].filter(Boolean).join(' ') || undefined}>
                <td>
                  <button
                    type="button" className={css.switch} role="switch"
                    aria-checked={r.enabled} aria-label={`Enable ${r.name}`}
                    onClick={async () => {
                      if (await mutate.run(() => toggleSource(r.id, !r.enabled))) sources.reload();
                    }}
                  >
                    <span className={css.switchKnob} />
                  </button>
                </td>
                <td className={css.sourceName}>{r.name}</td>
                <td className={css.sourceUrl}>{r.url}</td>
                <td>
                  <button type="button" className={`${css.buttonBare} ${css.linkCyan}`}
                    aria-expanded={open === r.id}
                    onClick={() => openTarget(open === r.id ? null : r.id)}>
                    {open === r.id ? 'Close' : 'Edit'}
                  </button>
                </td>
                <td>
                  <button type="button" className={`${css.buttonBare} ${css.linkMagenta}`} onClick={async () => {
                    if (await mutate.run(() => deleteSource(r.id))) {
                      // Only clear `open` when the deleted row was the one
                      // being edited — an unconditional clear here would
                      // discard an unrelated row's in-progress draft, which
                      // this file otherwise never does except on explicit
                      // close or a successful save.
                      if (open === r.id) openTarget(null);
                      sources.reload();
                    }
                  }}>Delete</button>
                </td>
              </tr>

              {open === r.id && (
                <tr>
                  <td colSpan={5} className={css.formCell}>
                    <SourceForm
                      // Remount on identity change so the draft is re-seeded
                      // from the row the user actually clicked.
                      key={r.id}
                      initial={toInput(r)}
                      formTitle={`Editing ${r.name}`}
                      submitLabel="Save this source"
                      saving={edit.saving}
                      error={edit.error}
                      onCancel={() => openTarget(null)}
                      onSubmit={async (input) => {
                        // Close only on success: a rejected save must keep the
                        // form and the user's typing.
                        if (await edit.run({ id: r.id, input })) {
                          openTarget(null);
                          sources.reload();
                        }
                      }}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}

          <tr>
            <td colSpan={5} className={css.addCell}>
              <button type="button" className={`${css.buttonBare} ${css.addLine}`}
                aria-expanded={open === 'new'}
                onClick={() => openTarget(open === 'new' ? null : 'new')}>
                {open === 'new' ? 'Cancel new source' : '+ Add a source'}
              </button>
            </td>
          </tr>
          {open === 'new' && (
            <tr>
              <td colSpan={5} className={css.formCell}>
                {/* The same component as the edit form above, so the two can
                    never drift apart. */}
                <SourceForm
                  formTitle="New source"
                  submitLabel="Add source"
                  saving={add.saving}
                  error={add.error}
                  onCancel={() => openTarget(null)}
                  onSubmit={async (input) => {
                    if (await add.run(input)) {
                      openTarget(null);
                      sources.reload();
                    }
                  }}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {mutate.error && <p className={css.inlineNote} role="alert">{mutate.error}</p>}
    </SettingsSection>
  );
}
