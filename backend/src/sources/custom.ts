import * as cheerio from 'cheerio';
import { htmlToText } from './html';
import type { FetchFn, JobSource, RawPosting } from '../types';
import type { SourceSpec } from '../settings/schema';

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Parameters that record how a visitor arrived rather than which posting they
 * arrived at. DOU's listing links carry `from=list_hot`, so the same vacancy
 * reached from two listing blocks would otherwise produce two posting ids and
 * be classified twice — the dedup gate is keyed on the id.
 */
const TRACKING_PARAM = /^(?:from|ref|referrer|source|fbclid|gclid|msclkid|mc_cid|mc_eid|utm_[a-z_]*)$/i;

/**
 * A stable per-source identifier for a posting. The pathname alone is not
 * enough: a board that addresses postings as `/job?id=42` would collapse every
 * posting onto one id and the pipeline would score exactly one of them. So the
 * query string survives, minus the parameters that identify a referrer rather
 * than a posting.
 */
export function externalIdFrom(url: string): string {
  const u = new URL(url);

  // Snapshot the keys before deleting: URLSearchParams iteration is live.
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }

  const search = u.searchParams.toString();
  return `${u.pathname.replace(/\/+$/, '')}${search === '' ? '' : `?${search}`}`;
}

export function createCustomSource(spec: SourceSpec, fetchFn: FetchFn = fetch): JobSource {
  const { selectors } = spec;

  return {
    id: spec.name,

    async listPostings(): Promise<RawPosting[]> {
      const res = await fetchFn(spec.url);
      if (!res.ok) {
        throw new Error(`${spec.name} returned HTTP ${res.status} for ${spec.url}`);
      }
      const $ = cheerio.load(await res.text());
      const out: RawPosting[] = [];

      $(selectors.item).each((_, el) => {
        const node = $(el);

        // An optional selector yields null when unset OR when it matches
        // nothing, so callers get one "absent" case instead of two.
        const pick = (sel?: string): string | null => {
          if (!sel) return null;
          const text = clean(node.find(sel).first().text());
          return text === '' ? null : text;
        };

        const link = node.find(selectors.link).first();
        const href = link.attr('href');
        if (!href) return;

        let url: string;
        try {
          url = new URL(href, spec.url).toString();
        } catch {
          return;
        }

        // Most boards put the title in the link itself; the selector exists for
        // the ones that do not.
        const title = pick(selectors.title) ?? clean(link.text());
        if (title === '') return;

        const externalId = externalIdFrom(url);

        out.push({
          id: `src:${spec.id}:${externalId}`,
          source: spec.name,
          externalId,
          url,
          title,
          // Right for a single-company careers page, which is the common case;
          // the selector is for aggregators.
          company: pick(selectors.company) ?? spec.name,
          location: pick(selectors.location),
          employmentType: pick(selectors.employmentType),
          description: pick(selectors.description) ?? '',
          raw: { html: node.html() },
        });
      });

      return out;
    },

    async hydrate(posting: RawPosting): Promise<RawPosting> {
      const res = await fetchFn(posting.url);
      if (!res.ok) {
        throw new Error(`${spec.name} detail returned HTTP ${res.status} for ${posting.url}`);
      }
      const html = await res.text();

      const description = selectors.detail
        ? clean(cheerio.load(html)(selectors.detail).text())
        : htmlToText(html);

      // A detail selector that matches nothing must not blank out whatever the
      // listing gave us — that would be a silent downgrade.
      return { ...posting, description: description === '' ? posting.description : description };
    },
  };
}
