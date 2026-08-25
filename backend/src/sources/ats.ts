import * as cheerio from 'cheerio';
import type { FetchFn, JobSource, RawPosting } from '../types';

export interface AtsEntry {
  board: 'greenhouse' | 'lever' | 'ashby';
  slug: string;
}

const ENDPOINTS: Record<AtsEntry['board'], (slug: string) => string> = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
};

export function htmlToText(html: string): string {
  return cheerio.load(html).root().text().replace(/\s+/g, ' ').trim();
}

function mapGreenhouse(slug: string, body: any): RawPosting[] {
  return (body.jobs ?? []).map((j: any) => ({
    id: `greenhouse:${slug}:${j.id}`,
    source: 'greenhouse',
    externalId: String(j.id),
    url: j.absolute_url,
    title: j.title,
    company: slug,
    location: j.location?.name ?? null,
    employmentType: null,
    description: htmlToText(j.content ?? ''),
    raw: j,
  }));
}

function mapLever(slug: string, body: any): RawPosting[] {
  return (body ?? []).map((j: any) => ({
    id: `lever:${slug}:${j.id}`,
    source: 'lever',
    externalId: String(j.id),
    url: j.hostedUrl,
    title: j.text,
    company: slug,
    location: j.categories?.location ?? null,
    employmentType: j.categories?.commitment ?? null,
    description: (j.descriptionPlain ?? '').replace(/\s+/g, ' ').trim(),
    raw: j,
  }));
}

function mapAshby(slug: string, body: any): RawPosting[] {
  return (body.jobs ?? []).map((j: any) => ({
    id: `ashby:${slug}:${j.id}`,
    source: 'ashby',
    externalId: String(j.id),
    url: j.jobUrl,
    title: j.title,
    company: slug,
    location: j.location ?? null,
    employmentType: j.employmentType ?? null,
    description: (j.descriptionPlain ?? '').replace(/\s+/g, ' ').trim(),
    raw: j,
  }));
}

export function createAtsSource(entry: AtsEntry, fetchFn: FetchFn = fetch): JobSource {
  const id = `${entry.board}:${entry.slug}`;
  return {
    id,
    async listPostings(): Promise<RawPosting[]> {
      const res = await fetchFn(ENDPOINTS[entry.board](entry.slug));
      if (!res.ok) throw new Error(`${id} returned HTTP ${res.status}`);
      const body = await res.json();
      if (entry.board === 'greenhouse') return mapGreenhouse(entry.slug, body);
      if (entry.board === 'lever') return mapLever(entry.slug, body);
      return mapAshby(entry.slug, body);
    },
  };
}
