import { corsConfigFrom } from './cors';

describe('corsConfigFrom', () => {
  it('returns undefined when the variable is unset', () => {
    expect(corsConfigFrom(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty or whitespace-only value', () => {
    expect(corsConfigFrom('')).toBeUndefined();
    expect(corsConfigFrom('   ')).toBeUndefined();
  });

  it('wraps a single origin in an array', () => {
    expect(corsConfigFrom('http://localhost:5173')).toEqual({
      origin: ['http://localhost:5173'],
    });
  });

  it('splits a comma-separated list and trims each entry', () => {
    expect(corsConfigFrom('http://a.example, http://b.example')).toEqual({
      origin: ['http://a.example', 'http://b.example'],
    });
  });

  it('drops empty entries from a ragged list', () => {
    expect(corsConfigFrom('http://a.example,, ,http://b.example')).toEqual({
      origin: ['http://a.example', 'http://b.example'],
    });
  });

  // The cors package compares array entries literally, so ['*'] would match
  // no origin at all. `true` is how that package spells "any origin".
  it('maps a bare asterisk to origin: true, not to ["*"]', () => {
    expect(corsConfigFrom('*')).toEqual({ origin: true });
    expect(corsConfigFrom('  *  ')).toEqual({ origin: true });
  });

  it('treats an asterisk inside a list as a literal origin, not a wildcard', () => {
    expect(corsConfigFrom('*,http://a.example')).toEqual({
      origin: ['*', 'http://a.example'],
    });
  });

  it('strips a single trailing slash, since the Origin header never has one', () => {
    expect(corsConfigFrom('http://a.example/')).toEqual({
      origin: ['http://a.example'],
    });
  });

  it('strips trailing slashes only from list entries that have one', () => {
    expect(corsConfigFrom('http://a.example/,http://b.example')).toEqual({
      origin: ['http://a.example', 'http://b.example'],
    });
  });

  it('leaves an origin without a trailing slash unchanged', () => {
    expect(corsConfigFrom('http://a.example')).toEqual({
      origin: ['http://a.example'],
    });
  });

  it('returns undefined when every entry in a ragged list is empty', () => {
    expect(corsConfigFrom(',,')).toBeUndefined();
  });
});
