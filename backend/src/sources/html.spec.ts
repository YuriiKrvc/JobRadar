import { htmlToText } from './html';

// These cases are the surviving coverage of what ats.spec.ts asserted about
// htmlToText through createAtsSource ("description contains the prose, and no
// markup"). The adapter is gone; the function it leaned on is not.
describe('htmlToText', () => {
  it('strips tags and keeps the prose', () => {
    expect(htmlToText('<p>We need a Node engineer with Postgres depth.</p>'))
      .toBe('We need a Node engineer with Postgres depth.');
  });

  it('leaves no markup behind', () => {
    expect(htmlToText('<p>alpha</p><div>beta</div>')).not.toContain('<');
  });

  it('collapses newlines and runs of whitespace to single spaces', () => {
    expect(htmlToText('<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>')).toBe('one two');
  });

  it('trims leading and trailing whitespace', () => {
    expect(htmlToText('   <span> padded </span>   ')).toBe('padded');
  });

  it('returns an empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('decodes html entities', () => {
    expect(htmlToText('<p>Node &amp; Postgres</p>')).toBe('Node & Postgres');
  });
});
