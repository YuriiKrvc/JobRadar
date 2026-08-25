import * as cheerio from 'cheerio';
import type { FetchFn, JobSource, RawPosting } from '../types';

const BASE = 'https://djinni.co';

// Djinni renders each vacancy as `div.job-item[id="job-item-<id>"]`, with the
// title inside `a.job_item__header-link > header h2.job-item__position`. The
// older `li.list-jobs__item` / `a.job-item__title-link` markup is kept as a
// fallback so a revert on their side does not break the adapter.
const ITEM = 'div.job-item[id^="job-item-"], li.list-jobs__item, li[id^="job-item"]';
const LINK = 'a.job_item__header-link, a.job-item__title-link, a.job-list-item__link';
const TITLE = 'h2.job-item__position, .job-item__position';
const COMPANY = 'header .text-gray-800, a.js-analytics-event, .job-list-item__company';
const INFO = 'div.fw-medium, .job-list-item__job-info, .job-item__description';

export function createDjinniSource(listUrl: string, fetchFn: FetchFn = fetch): JobSource {
  return {
    id: 'djinni',
    async listPostings(): Promise<RawPosting[]> {
      const res = await fetchFn(listUrl);
      if (!res.ok) throw new Error(`djinni returned HTTP ${res.status} for ${listUrl}`);
      const $ = cheerio.load(await res.text());
      const out: RawPosting[] = [];

      $(ITEM).each((_, el) => {
        const node = $(el);
        const link = node.find(LINK).first();
        const href = link.attr('href');
        if (!href) return;
        const url = href.startsWith('http') ? href : `${BASE}${href}`;
        const externalId = /\/jobs\/(\d+)/.exec(url)?.[1] ?? url;
        const title = (node.find(TITLE).first().text() || link.text())
          .replace(/\s+/g, ' ').trim();
        if (!title) return;
        const company = node.find(COMPANY).first()
          .text().replace(/\s+/g, ' ').trim() || 'unknown';
        const info = node.find(INFO).first()
          .text().replace(/\s+/g, ' ').trim();
        const location = node.find('.location-text').first()
          .text().replace(/\s+/g, ' ').trim() || info.split('·')[0]?.trim() || null;

        out.push({
          id: `djinni:${externalId}`,
          source: 'djinni',
          externalId,
          url,
          title,
          company,
          location,
          employmentType: null,
          description: info,
          raw: { html: node.html() },
        });
      });

      return out;
    },
  };
}
