import { describe, it, expect, beforeAll } from 'vitest';
import { PostingsRepository } from '../../src/db/postings.repository';
import { createDb } from '../../src/db/client';
import type { RawPosting, FitVerdict } from '../../src/types';

const url = process.env.DATABASE_URL_TEST;
const d = (score: number) => ({ score, note: 'n' });

function posting(id: string): RawPosting {
  return {
    id, source: 'x', externalId: id, url: 'https://e.com/1', title: 'T',
    company: 'C', location: 'Remote', employmentType: 'full-time',
    description: 'body', raw: { a: 1 },
  };
}

function verdict(total: number, v: FitVerdict['verdict']): FitVerdict {
  return {
    total, verdict: v,
    subscores: { coreStack: d(1), seniority: d(1), domain: d(1), logistics: d(1), growth: d(1) },
    reasoning: 'because', providerId: 'fake', settingsVersion: '1',
  };
}

describe.skipIf(!url)('PostingsRepository', () => {
  let repo: PostingsRepository;

  beforeAll(async () => {
    const db = createDb(url!);
    await db.execute('TRUNCATE notifications, scores, run_log, postings RESTART IDENTITY CASCADE' as any);
    // Constructed directly rather than via Test.createTestingModule: Vitest's
    // transform does not emit design:paramtypes, so Nest DI cannot resolve
    // constructor types here. The class needs no container.
    repo = new PostingsRepository(db);
  });

  it('reports isNew true on first upsert and false on repeat', async () => {
    expect(await repo.upsert(posting('x:1'))).toEqual({ isNew: true });
    expect(await repo.upsert(posting('x:1'))).toEqual({ isNew: false });
  });

  it('reports hasScore false until a score exists, then true', async () => {
    await repo.upsert(posting('x:7'));
    expect(await repo.hasScore('x:7')).toBe(false);
    await repo.insertScore('x:7', verdict(60, 'MAYBE'));
    expect(await repo.hasScore('x:7')).toBe(true);
  });

  it('appends scores rather than replacing them', async () => {
    await repo.upsert(posting('x:2'));
    const a = await repo.insertScore('x:2', verdict(80, 'STRONG'));
    const b = await repo.insertScore('x:2', verdict(40, 'NO'));
    expect(b).not.toBe(a);
  });

  it('returns scores above the threshold with no successful notification', async () => {
    await repo.upsert(posting('x:3'));
    const id = await repo.insertScore('x:3', verdict(90, 'STRONG'));
    const pending = await repo.pendingNotifications(50, 'telegram');
    expect(pending.map((p) => p.scoreId)).toContain(id);
    expect(pending.find((p) => p.scoreId === id)!.title).toBe('T');
  });

  it('stops returning a score once it is successfully notified', async () => {
    await repo.upsert(posting('x:4'));
    const id = await repo.insertScore('x:4', verdict(95, 'STRONG'));
    await repo.recordNotification(id, 'telegram');
    expect((await repo.pendingNotifications(50, 'telegram')).map((p) => p.scoreId)).not.toContain(id);
  });

  it('keeps returning a score whose notification failed', async () => {
    await repo.upsert(posting('x:5'));
    const id = await repo.insertScore('x:5', verdict(95, 'STRONG'));
    await repo.recordNotification(id, 'telegram', 'network down');
    expect((await repo.pendingNotifications(50, 'telegram')).map((p) => p.scoreId)).toContain(id);
  });

  it('excludes scores below the threshold', async () => {
    await repo.upsert(posting('x:6'));
    const id = await repo.insertScore('x:6', verdict(30, 'NO'));
    expect((await repo.pendingNotifications(50, 'telegram')).map((p) => p.scoreId)).not.toContain(id);
  });

  it('writes run log rows', async () => {
    await repo.logRun('djinni', 'error', 0, 'selector miss');
    await repo.logRun('dou', 'ok', 12);
  });
});
