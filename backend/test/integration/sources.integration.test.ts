import { describe, it, expect } from 'vitest';
import { createCustomSource } from '../../src/sources/custom';

// Run with: INTEGRATION=1 npm run test:integration
describe.skipIf(!process.env.INTEGRATION)('live sources', () => {
  it('parses a real listing page from stored selectors', async () => {
    const source = createCustomSource({
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Djinni',
      url: 'https://djinni.co/jobs/keyword-node/',
      selectors: {
        item: 'div.job-item[id^="job-item-"], li.list-jobs__item, li[id^="job-item"]',
        link: 'a.job_item__header-link, a.job-item__title-link, a.job-list-item__link',
        title: 'h2.job-item__position, .job-item__position',
        company: 'header .text-gray-800, a.js-analytics-event, .job-list-item__company',
        location: '.location-text',
        description: 'div.fw-medium, .job-list-item__job-info, .job-item__description',
      },
      blockedTitleWords: [],
      blockedDescriptionWords: [],
    });

    const out = await source.listPostings();
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.title.length).toBeGreaterThan(0);
    expect(out[0]!.url).toMatch(/^https:\/\/djinni\.co\//);
    expect(out[0]!.source).toBe('Djinni');
  }, 30_000);

  it('hydrates a real posting page', async () => {
    // Two hops on purpose: hydrate is the step no unit test can prove against
    // a live site.
    const source = createCustomSource({
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Djinni',
      url: 'https://djinni.co/jobs/keyword-node/',
      selectors: {
        item: 'div.job-item[id^="job-item-"], li.list-jobs__item, li[id^="job-item"]',
        link: 'a.job_item__header-link, a.job-item__title-link, a.job-list-item__link',
      },
      blockedTitleWords: [],
      blockedDescriptionWords: [],
    });

    const [first] = await source.listPostings();
    const full = await source.hydrate!(first!);
    expect(full.description.length).toBeGreaterThan(first!.description.length);
  }, 30_000);
});
