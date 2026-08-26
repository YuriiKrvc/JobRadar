import { Fragment, useState } from 'react';
import { addSource, deleteSource, fetchSources, toggleSource, updateSource } from '../api/settings';
import { useApi } from '../hooks/useApi';
import { useSave } from '../hooks/useSave';
import { SettingsSection } from './SettingsSection';
import { SourceForm } from './SourceForm';
import type { SourceInput, SourceRow } from '../api/types';

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

  return (
    <SettingsSection
      id="sources" title="Sources" blurb="Boards polled every 30 minutes."
      version={version}
      // Sources has nothing to save: every row write is its own request, and
      // none of them bumps the scoring version.
      note="Sources save as you go and do not change the scoring version."
      state={{ dirty: false, saving: false, saved: false, error: null }}
    >
      <div className="settings-section-body">
        {sources.error && <p className="state" role="alert">Error: {sources.error}</p>}
        {sources.data?.length === 0 && (
          <p className="state">No sources configured — add one below.</p>
        )}

        <table className="table sources-table">
          <thead>
            <tr>
              <th className="col-on">On</th>
              <th className="col-name">Name</th>
              <th>Listing URL</th>
              <th className="col-edit" />
              <th className="col-delete" />
            </tr>
          </thead>
          <tbody>
            {(sources.data ?? []).map((r) => (
              <Fragment key={r.id}>
                <tr className={`${r.enabled ? '' : 'row-disabled'} ${open === r.id ? 'row-editing' : ''}`}>
                  <td>
                    <button
                      type="button" className="switch" role="switch"
                      aria-checked={r.enabled} aria-label={`Enable ${r.name}`}
                      onClick={async () => {
                        if (await mutate.run(() => toggleSource(r.id, !r.enabled))) sources.reload();
                      }}
                    >
                      <span className="switch-knob" />
                    </button>
                  </td>
                  <td className="source-name">{r.name}</td>
                  <td className="source-url">{r.url}</td>
                  <td>
                    <button type="button" className="btn-bare link-cyan"
                      aria-expanded={open === r.id}
                      onClick={() => setOpen(open === r.id ? null : r.id)}>
                      {open === r.id ? 'Close' : 'Edit'}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="btn-bare link-magenta" onClick={async () => {
                      if (await mutate.run(() => deleteSource(r.id))) {
                        setOpen(null);
                        sources.reload();
                      }
                    }}>Delete</button>
                  </td>
                </tr>

                {open === r.id && (
                  <tr>
                    <td colSpan={5} className="source-form-cell">
                      <SourceForm
                        // Remount on identity change so the draft is re-seeded
                        // from the row the user actually clicked.
                        key={r.id}
                        initial={toInput(r)}
                        formTitle={`Editing ${r.name}`}
                        submitLabel="Save this source"
                        saving={edit.saving}
                        error={edit.error}
                        onCancel={() => setOpen(null)}
                        onSubmit={async (input) => {
                          // Close only on success: a rejected save must keep the
                          // form and the user's typing.
                          if (await edit.run({ id: r.id, input })) {
                            setOpen(null);
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
              <td colSpan={5} className="add-source-cell">
                <button type="button" className="btn-bare add-source-line"
                  aria-expanded={open === 'new'}
                  onClick={() => setOpen(open === 'new' ? null : 'new')}>
                  {open === 'new' ? 'Cancel new source' : '+ Add a source'}
                </button>
              </td>
            </tr>
            {open === 'new' && (
              <tr>
                <td colSpan={5} className="source-form-cell">
                  {/* The same component as the edit form above, so the two can
                      never drift apart. */}
                  <SourceForm
                    formTitle="New source"
                    submitLabel="Add source"
                    saving={add.saving}
                    error={add.error}
                    onCancel={() => setOpen(null)}
                    onSubmit={async (input) => {
                      if (await add.run(input)) {
                        setOpen(null);
                        sources.reload();
                      }
                    }}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {mutate.error && <p className="state" role="alert">{mutate.error}</p>}
      </div>
    </SettingsSection>
  );
}
