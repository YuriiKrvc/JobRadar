import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PostingsController } from './postings.controller';
import { HealthController } from './health.controller';
import { DashboardQueries } from './dashboard.queries';
import type { HealthRow, PostingRow } from './api.schema';

const rows: PostingRow[] = [{
  postingId: 'x:1', title: 'Senior Node Engineer', company: 'Acme',
  url: 'https://e.com/1', source: 'djinni', location: 'Remote',
  total: 82, verdict: 'STRONG', reasoning: 'good',
  providerId: 'anthropic:claude-haiku-4-5', scoredAt: '2026-08-25T10:00:00.000Z',
}];

const health: HealthRow[] = [
  { source: 'djinni', status: 'error', ranAt: '2026-08-25T10:00:00.000Z', error: 'selector miss' },
];

let captured: any;

async function build(over: Partial<DashboardQueries> = {}): Promise<INestApplication> {
  const queries = {
    latestScores: async (f: any) => { captured = f; return rows; },
    sourceHealth: async () => health,
    ...over,
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [PostingsController, HealthController],
    providers: [{ provide: DashboardQueries, useValue: queries }],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('REST API', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await build(); });

  it('GET /healthz returns ok', async () => {
    await request(app.getHttpServer()).get('/healthz').expect(200, { ok: true });
  });

  it('GET /api/postings returns every row as JSON', async () => {
    const res = await request(app.getHttpServer()).get('/api/postings').expect(200);
    expect(res.body.postings).toHaveLength(1);
    expect(res.body.postings[0].title).toBe('Senior Node Engineer');
    expect(typeof res.body.postings[0].scoredAt).toBe('string');
  });

  it('passes coerced query filters through to the query service', async () => {
    await request(app.getHttpServer())
      .get('/api/postings?verdict=STRONG&source=djinni&minTotal=60&limit=10')
      .expect(200);
    expect(captured).toMatchObject({ verdict: 'STRONG', source: 'djinni', minTotal: 60, limit: 10 });
  });

  it('rejects an unknown verdict with 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/postings?verdict=BANANA').expect(400);
    expect(res.body.message ?? res.body.error).toMatch(/verdict/i);
  });

  it('rejects a non-numeric minTotal with 400', async () => {
    await request(app.getHttpServer()).get('/api/postings?minTotal=abc').expect(400);
  });

  it('GET /api/health returns run log rows', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.sources[0]).toMatchObject({ source: 'djinni', status: 'error' });
  });

  it('returns 500 when a query throws', async () => {
    const failing = await build({ latestScores: async () => { throw new Error('db exploded'); } });
    await request(failing.getHttpServer()).get('/api/postings').expect(500);
    await failing.close();
  });
});
