import * as cheerio from 'cheerio';
import type { FetchFn, JobSource, RawPosting } from '../types';

export function createDouSource(listUrl: string, fetchFn: FetchFn = fetch): JobSource {
  return {
    id: 'dou',
    async listPostings(): Promise<RawPosting[]> {
      const res = await fetchFn(listUrl);
      if (!res.ok) throw new Error(`dou returned HTTP ${res.status} for ${listUrl}`);
      const $ = cheerio.load(await res.text());
      const out: RawPosting[] = [];

      $('li.l-vacancy').each((_, el) => {
        const node = $(el);
        const link = node.find('a.vt').first();
        const url = link.attr('href');
        if (!url) return;
        const externalId = /\/vacancies\/(\d+)/.exec(url)?.[1] ?? url;
        const description = node.find('div.sh-info').text().replace(/\s+/g, ' ').trim();

        out.push({
          id: `dou:${externalId}`,
          source: 'dou',
          externalId,
          url,
          title: link.text().replace(/\s+/g, ' ').trim(),
          company: node.find('a.company').text().replace(/\s+/g, ' ').trim() || 'unknown',
          location: node.find('span.cities').text().replace(/\s+/g, ' ').trim() || null,
          employmentType: null,
          description,
          raw: { html: node.html() },
        });
      });

      return out;
    },
  };
}
