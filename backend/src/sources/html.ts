import * as cheerio from 'cheerio';

/** Collapse an HTML document to a single line of whitespace-normalised text. */
export function htmlToText(html: string): string {
  return cheerio.load(html).root().text().replace(/\s+/g, ' ').trim();
}
