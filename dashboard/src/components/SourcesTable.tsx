import { Fragment, useState } from 'react';
import { addSource, deleteSource, fetchSources, toggleSource, updateSource } from '../api/settings';
import { useApi } from '../hooks/useApi';
import { useSave } from '../hooks/useSave';
import type { SourceInput, SourceKind, SourceRow } from '../api/types';
import s from './settings.module.css';

const BOARDS = ['greenhouse', 'lever', 'ashby'] as const;

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
                <tr key={r.id} className={r.enabled ? undefined : s.rowDisabled}>
                  <td>
                    <input
                      type="checkbox" checked={r.enabled}
                      aria-label={`Enable ${identity(r)}`}
                      onChange={async () => {
                        if (await mutate.run(() => toggleSource(r.id, !r.enabled))) sources.reload();
                      }}
                    />
                  </td>
                  <td>{r.kind}</td>
                  <td>{identity(r)}</td>
                  <td>
                    <button type="button" onClick={async () => {
                      if (await mutate.run(() => deleteSource(r.id))) sources.reload();
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      {/* Identity is immutable: postings.id derives from board:slug, so a typo
          is fixed by delete-and-re-add, not by editing in place. */}
      <div className={s.addSource}>
        <div className={s.field}>
          <label htmlFor="source-kind">Kind</label>
          <select id="source-kind" value={kind} disabled={add.saving}
            onChange={(e) => setKind(e.target.value as SourceKind)}>
            <option value="ats">ats</option>
            <option value="djinni">djinni</option>
            <option value="dou">dou</option>
          </select>
        </div>

        {kind === 'ats' ? (
          <>
            <div className={s.field}>
              <label htmlFor="source-board">Board</label>
              <select id="source-board" value={board} disabled={add.saving}
                onChange={(e) => setBoard(e.target.value as (typeof BOARDS)[number])}>
                {BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className={s.field}>
              <label htmlFor="source-slug">Slug</label>
              <input id="source-slug" value={slug} disabled={add.saving}
                onChange={(e) => setSlug(e.target.value)} />
            </div>
          </>
        ) : (
          <div className={s.field}>
            <label htmlFor="source-url">URL</label>
            <input id="source-url" value={url} disabled={add.saving}
              onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}

        <div className={s.actions}>
          <button type="button" disabled={add.saving} onClick={submit}>
            {add.saving ? 'Adding…' : 'Add source'}
          </button>
          {add.error && <span className={s.state} role="alert">{add.error}</span>}
          {mutate.error && <span className={s.state} role="alert">{mutate.error}</span>}
        </div>
      </div>
    </section>
  );
}
