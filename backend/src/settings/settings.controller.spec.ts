import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SettingsController } from './settings.controller';
import { SettingsRepository } from './settings.repository';

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };
const PROFILE = {
  excludedLocations: ['United States'], allowedEmploymentTypes: ['full-time'],
  minSalaryUsd: 5000, timezone: 'Europe/Kyiv',
};

function fakeRepo() {
  return {
    row: {
      id: true, cv: 'my cv', rubricBody: 'score it', rubricWeights: WEIGHTS,
      profile: PROFILE, version: 3, updatedAt: new Date('2026-08-25T10:00:00Z'),
    },
    readRow: jest.fn(async function (this: any) { return this.row; }),
    updateCv: jest.fn(async function (this: any) { this.row.version += 1; }),
    updateRubric: jest.fn(async function (this: any) { this.row.version += 1; }),
    updateProfile: jest.fn(async function (this: any) { this.row.version += 1; }),
  };
}

async function build(repo = fakeRepo()) {
  const moduleRef = await Test.createTestingModule({
    controllers: [SettingsController],
    providers: [{ provide: SettingsRepository, useValue: repo }],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return { app, repo };
}

describe('GET /api/settings', () => {
  it('returns every document and the current version', async () => {
    const { app } = await build();
    const res = await request(app.getHttpServer()).get('/api/settings').expect(200);

    expect(res.body).toEqual({
      cv: 'my cv',
      rubricBody: 'score it',
      rubricWeights: WEIGHTS,
      profile: PROFILE,
      version: 3,
      updatedAt: '2026-08-25T10:00:00.000Z',
    });
    await app.close();
  });

  it('never leaks the singleton primary key', async () => {
    const { app } = await build();
    const res = await request(app.getHttpServer()).get('/api/settings').expect(200);
    expect(res.body).not.toHaveProperty('id');
    await app.close();
  });
});

describe('PUT /api/settings/cv', () => {
  it('saves and returns the bumped version', async () => {
    const { app, repo } = await build();
    const res = await request(app.getHttpServer())
      .put('/api/settings/cv').send({ cv: 'new cv' }).expect(200);

    expect(repo.updateCv).toHaveBeenCalledWith('new cv');
    expect(res.body).toEqual({ version: 4 });
    await app.close();
  });

  it('accepts an empty cv, which a fresh install has', async () => {
    const { app } = await build();
    await request(app.getHttpServer()).put('/api/settings/cv').send({ cv: '' }).expect(200);
    await app.close();
  });

  it('rejects a missing cv field with a 400 naming it', async () => {
    const { app } = await build();
    const res = await request(app.getHttpServer())
      .put('/api/settings/cv').send({}).expect(400);
    expect(res.body.message).toMatch(/cv/);
    await app.close();
  });

  it('rejects an unknown field', async () => {
    const { app } = await build();
    await request(app.getHttpServer())
      .put('/api/settings/cv').send({ cv: 'x', sneaky: 1 }).expect(400);
    await app.close();
  });
});

describe('PUT /api/settings/rubric', () => {
  it('saves body and weights together', async () => {
    const { app, repo } = await build();
    const weights = { ...WEIGHTS, coreStack: 70 };
    const res = await request(app.getHttpServer())
      .put('/api/settings/rubric').send({ body: 'new rubric', weights }).expect(200);

    expect(repo.updateRubric).toHaveBeenCalledWith('new rubric', weights);
    expect(res.body).toEqual({ version: 4 });
    await app.close();
  });

  it('rejects all-zero weights', async () => {
    const { app } = await build();
    const zeroed = { coreStack: 0, seniority: 0, domain: 0, logistics: 0, growth: 0 };
    const res = await request(app.getHttpServer())
      .put('/api/settings/rubric').send({ body: 'x', weights: zeroed }).expect(400);
    expect(res.body.message).toMatch(/above zero/);
    await app.close();
  });

  it('rejects a missing dimension', async () => {
    const { app } = await build();
    const { growth, ...partial } = WEIGHTS;
    await request(app.getHttpServer())
      .put('/api/settings/rubric').send({ body: 'x', weights: partial }).expect(400);
    await app.close();
  });
});

describe('PUT /api/settings/profile', () => {
  it('saves a valid profile', async () => {
    const { app, repo } = await build();
    const next = { ...PROFILE, minSalaryUsd: 9000 };
    const res = await request(app.getHttpServer())
      .put('/api/settings/profile').send(next).expect(200);

    expect(repo.updateProfile).toHaveBeenCalledWith(next);
    expect(res.body).toEqual({ version: 4 });
    await app.close();
  });

  it('saves a full profile that clears the list fields', async () => {
    const { app, repo } = await build();
    const next = {
      excludedLocations: [], allowedEmploymentTypes: [],
      minSalaryUsd: null, timezone: 'Europe/Berlin',
    };
    const res = await request(app.getHttpServer())
      .put('/api/settings/profile').send(next).expect(200);

    expect(repo.updateProfile).toHaveBeenCalledWith(next);
    expect(res.body).toEqual({ version: 4 });
    await app.close();
  });

  // The PUT replaces the whole document, so a partial body would silently wipe
  // the omitted fields, bump the version, and invalidate every prior score.
  // Defaults belong to the file importer, not to a user-facing write.
  it('rejects a partial profile instead of defaulting the omitted fields', async () => {
    const { app, repo } = await build();
    const res = await request(app.getHttpServer())
      .put('/api/settings/profile').send({ timezone: 'Europe/Berlin' }).expect(400);

    expect(res.body.message).toMatch(/excludedLocations/);
    expect(repo.updateProfile).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ['excludedLocations'], ['allowedEmploymentTypes'], ['minSalaryUsd'], ['timezone'],
  ])('rejects a profile missing %s', async (field) => {
    const { app, repo } = await build();
    const body: Record<string, unknown> = { ...PROFILE };
    delete body[field];

    const res = await request(app.getHttpServer())
      .put('/api/settings/profile').send(body).expect(400);
    expect(res.body.message).toMatch(new RegExp(field));
    expect(repo.updateProfile).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an unknown key, like the cv and rubric endpoints', async () => {
    const { app, repo } = await build();
    await request(app.getHttpServer())
      .put('/api/settings/profile').send({ ...PROFILE, nope: 1 }).expect(400);
    expect(repo.updateProfile).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a negative salary with a message naming the field', async () => {
    const { app } = await build();
    const res = await request(app.getHttpServer())
      .put('/api/settings/profile').send({ ...PROFILE, minSalaryUsd: -5 }).expect(400);
    expect(res.body.message).toMatch(/minSalaryUsd/);
    await app.close();
  });
});
