import { Fragment, useState } from 'react';
import { addSource, deleteSource, fetchSources, toggleSource, updateSource } from '../api/settings';
import { useApi } from '../hooks/useApi';
import { useSave } from '../hooks/useSave';
import { SourceForm } from './SourceForm';
import type { SourceInput, SourceRow } from '../api/types';
import s from './settings.module.css';

function toInput(r: SourceRow): SourceInput {
  return {
    name: r.name, url: r.url, selectors: r.selectors,
    blockedTitleWords: r.blockedTitleWords,
    blockedDescriptionWords: r.blockedDescriptionWords,
  };
}

export function SourcesTable() {
  const sources = useApi(() => fetchSources());
  const [editing, setEditing] = useState<string | null>(null);

  const add = useSave<SourceInput>(addSource);
  const edit = useSave<{ id: string; input: SourceInput }>(({ id, input }) => updateSource(id, input));
  const mutate = useSave<() => Promise<unknown>>((fn) => fn());

  return (
    <section className={s.section}>
      <h2>Sources</h2>

      {sources.error && <p className={s.state} role="alert">Error: {sources.error}</p>}

      {sources.data?.length === 0
        ? <p className={s.state}>No sources configured — add one below.</p>
        : (
          <table className={s.table}>
            <thead>
              <tr><th>On</th><th>Name</th><th>URL</th><th /><th /></tr>
            </thead>
            <tbody>
              {(sources.data ?? []).map((r) => (
                <Fragment key={r.id}>
                  <tr className={r.enabled ? undefined : s.rowDisabled}>
                    <td>
                      <input
                        type="checkbox" checked={r.enabled}
                        aria-label={`Enable ${r.name}`}
                        onChange={async () => {
                          if (await mutate.run(() => toggleSource(r.id, !r.enabled))) sources.reload();
                        }}
                      />
                    </td>
                    <td>{r.name}</td>
                    <td>{r.url}</td>
                    <td>
                      <button type="button" onClick={() => setEditing(editing === r.id ? null : r.id)}>
                        Edit
                      </button>
                    </td>
                    <td>
                      <button type="button" onClick={async () => {
                        if (await mutate.run(() => deleteSource(r.id))) sources.reload();
                      }}>Delete</button>
                    </td>
                  </tr>
                  {editing === r.id && (
                    <tr>
                      <td colSpan={5}>
                        <SourceForm
                          // Remount on identity change so the draft is re-seeded
                          // from the row the user actually clicked.
                          key={r.id}
                          initial={toInput(r)}
                          submitLabel="Save source"
                          saving={edit.saving}
                          error={edit.error}
                          onCancel={() => setEditing(null)}
                          onSubmit={async (input) => {
                            // Close only on success: a rejected save must keep
                            // the form and the user's typing.
                            if (await edit.run({ id: r.id, input })) {
                              setEditing(null);
                              sources.reload();
                            }
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

      <h3>Add a source</h3>
      <SourceForm
        submitLabel="Add source"
        saving={add.saving}
        error={add.error}
        onSubmit={async (input) => { if (await add.run(input)) sources.reload(); }}
      />
      {mutate.error && <p className={s.state} role="alert">{mutate.error}</p>}
    </section>
  );
}
