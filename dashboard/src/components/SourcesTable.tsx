import { useState } from 'react';
import { addSource, deleteSource, fetchSources, toggleSource } from '../api/settings';
import { useApi } from '../hooks/useApi';
import { useSave } from '../hooks/useSave';
import type { SourceInput, SourceKind, SourceRow } from '../api/types';

const BOARDS = ['greenhouse', 'lever', 'ashby'] as const;

function identity(r: SourceRow): string {
  return r.kind === 'ats' ? `${r.board}:${r.slug}` : (r.url ?? '');
}

export function SourcesTable() {
  const sources = useApi(() => fetchSources());

  const [kind, setKind] = useState<SourceKind>('ats');
  const [board, setBoard] = useState<(typeof BOARDS)[number]>('greenhouse');
  const [slug, setSlug] = useState('');
  const [url, setUrl] = useState('');

  const add = useSave<SourceInput>(addSource);
  const mutate = useSave<() => Promise<unknown>>((fn) => fn());

  async function submit() {
    const input: SourceInput = kind === 'ats'
      ? { kind: 'ats', board, slug }
      : { kind, url };

    if (await add.run(input)) sources.reload();
  }

  return (
    <section className="settings-section">
      <h2>Sources</h2>

      {sources.error && <p className="state" role="alert">Error: {sources.error}</p>}

      {sources.data?.length === 0
        ? <p className="state">No sources configured — add one below.</p>
        : (
          <table>
            <thead>
              <tr><th>On</th><th>Kind</th><th>Identity</th><th /></tr>
            </thead>
            <tbody>
              {(sources.data ?? []).map((r) => (
                <tr key={r.id} className={r.enabled ? undefined : 'row-disabled'}>
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
      <div className="add-source">
        <div className="field">
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
            <div className="field">
              <label htmlFor="source-board">Board</label>
              <select id="source-board" value={board} disabled={add.saving}
                onChange={(e) => setBoard(e.target.value as (typeof BOARDS)[number])}>
                {BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="source-slug">Slug</label>
              <input id="source-slug" value={slug} disabled={add.saving}
                onChange={(e) => setSlug(e.target.value)} />
            </div>
          </>
        ) : (
          <div className="field">
            <label htmlFor="source-url">URL</label>
            <input id="source-url" value={url} disabled={add.saving}
              onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}

        <div className="settings-actions">
          <button type="button" disabled={add.saving} onClick={submit}>
            {add.saving ? 'Adding…' : 'Add source'}
          </button>
          {add.error && <span className="state" role="alert">{add.error}</span>}
          {mutate.error && <span className="state" role="alert">{mutate.error}</span>}
        </div>
      </div>
    </section>
  );
}
