import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SourcesController } from './sources.controller';
import { SettingsRepository } from './settings.repository';

const ID = '11111111-1111-1111-1111-111111111111';

function row(over: Record<string, unknown> = {}) {
  return {
    id: ID, name: 'Acme', url: 'https://acme.com/careers',
    selectors: { item: 'li.job', link: 'a' },
    blockedTitleWords: [], blockedDescriptionWords: [],
    enabled: true, createdAt: new Date('2026-08-25T10:00:00Z'), ...over,
  };
}

function fakeRepo() {
  return {
    listSources: jest.fn(async () => [row(), row({ id: 'other', enabled: false })]),
    addSource: jest.fn(async () => row()),
    setSourceEnabled: jest.fn(async (): Promise<ReturnType<typeof row> | null> => row({ enabled: false })),
    deleteSource: jest.fn(async () => true),
  };
}

async function build(repo: ReturnType<typeof fakeRepo> = fakeRepo()) {
  const moduleRef = await Test.createTestingModule({
    controllers: [SourcesController],
    providers: [{ provide: SettingsRepository, useValue: repo }],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return { app, repo };
}

describe('GET /api/sources', () => {
  it('returns disabled sources too, so they can be re-enabled', async () => {
    const { app } = await build();
    const res = await request(app.getHttpServer()).get('/api/sources').expect(200);
    expect(res.body.sources).toHaveLength(2);
    expect(res.body.sources.map((s: any) => s.enabled)).toEqual([true, false]);
    await app.close();
  });
});

describe('POST /api/sources', () => {
  const input = {
    name: 'Acme', url: 'https://acme.com/careers',
    selectors: { item: 'li.job', link: 'a' },
  };

  it('creates a source and returns 201', async () => {
    const { app, repo } = await build();
    const res = await request(app.getHttpServer()).post('/api/sources').send(input).expect(201);

    // The Zod defaults reach the repository, so it can insert the body as-is.
    expect(repo.addSource).toHaveBeenCalledWith({
      ...input, blockedTitleWords: [], blockedDescriptionWords: [],
    });
    expect(res.body.source.id).toBe(ID);
    await app.close();
  });

  it('rejects a body with no selectors', async () => {
    const { app } = await build();
    await request(app.getHttpServer())
      .post('/api/sources').send({ name: 'Acme', url: 'https://acme.com/careers' }).expect(400);
    await app.close();
  });

  it('rejects an unknown key', async () => {
    const { app } = await build();
    await request(app.getHttpServer())
      .post('/api/sources').send({ ...input, kind: 'ats' }).expect(400);
    await app.close();
  });

  it('maps a unique violation to 409 rather than letting a 500 escape', async () => {
    const repo = fakeRepo();
    repo.addSource = jest.fn(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });
    const { app } = await build(repo);
    const res = await request(app.getHttpServer())
      .post('/api/sources').send(input).expect(409);
    expect(res.body.message).toMatch(/already/i);
    await app.close();
  });

  it('does not swallow an unrelated database error', async () => {
    const repo = fakeRepo();
    repo.addSource = jest.fn(async () => {
      throw Object.assign(new Error('connection reset'), { code: '08006' });
    });
    const { app } = await build(repo);
    await request(app.getHttpServer()).post('/api/sources').send(input).expect(500);
    await app.close();
  });
});

describe('PATCH /api/sources/:id', () => {
  it('toggles enabled', async () => {
    const { app, repo } = await build();
    const res = await request(app.getHttpServer())
      .patch(`/api/sources/${ID}`).send({ enabled: false }).expect(200);

    expect(repo.setSourceEnabled).toHaveBeenCalledWith(ID, false);
    expect(res.body.source.enabled).toBe(false);
    await app.close();
  });

  it('404s an unknown id', async () => {
    const repo = fakeRepo();
    repo.setSourceEnabled = jest.fn(async () => null);
    const { app } = await build(repo);
    await request(app.getHttpServer())
      .patch(`/api/sources/${ID}`).send({ enabled: true }).expect(404);
    await app.close();
  });

  it('rejects an attempt to edit a source identity', async () => {
    const { app } = await build();
    await request(app.getHttpServer())
      .patch(`/api/sources/${ID}`).send({ enabled: true, name: 'renamed' }).expect(400);
    await app.close();
  });

  it('400s a non-uuid id before touching the repository', async () => {
    const { app, repo } = await build();
    await request(app.getHttpServer())
      .patch('/api/sources/not-a-uuid').send({ enabled: true }).expect(400);
    expect(repo.setSourceEnabled).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('DELETE /api/sources/:id', () => {
  it('returns 204 when the row existed', async () => {
    const { app, repo } = await build();
    await request(app.getHttpServer()).delete(`/api/sources/${ID}`).expect(204);
    expect(repo.deleteSource).toHaveBeenCalledWith(ID);
    await app.close();
  });

  it('404s when it did not', async () => {
    const repo = fakeRepo();
    repo.deleteSource = jest.fn(async () => false);
    const { app } = await build(repo);
    await request(app.getHttpServer()).delete(`/api/sources/${ID}`).expect(404);
    await app.close();
  });
});
