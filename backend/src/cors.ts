/**
 * CORS configuration derived from the CORS_ORIGIN environment variable.
 *
 * `origin: true` means "any origin"; a string array is matched literally by the
 * `cors` package that Nest delegates to.
 */
export type CorsConfig = { origin: string[] | true };

/**
 * Parses CORS_ORIGIN into options for `app.enableCors()`.
 *
 * Returns `undefined` when the variable is absent or blank, which leaves CORS
 * off — the right default for the worker and for API deployments with no
 * browser client. A bare `*` becomes `origin: true` rather than `['*']`,
 * because the `cors` package compares array entries literally and `['*']`
 * would therefore match no request at all.
 */
export function corsConfigFrom(raw: string | undefined): CorsConfig | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (trimmed === '*') return { origin: true };

  const origins = trimmed
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  return origins.length > 0 ? { origin: origins } : undefined;
}
