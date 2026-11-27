/** Default to this site's public API; allow a separately hosted backend. */
export function resolveApiBaseUrl(configured: string | undefined, origin: string): string {
  return (configured?.trim() || origin).replace(/\/+$/, '');
}
