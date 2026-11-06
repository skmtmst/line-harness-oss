const invalidProfileUrl = 'officialProfileUrl must be a https://lin.ee/ or https://line.me/R/ti/p/@ URL';

export function readOfficialProfileUrl(
  value: unknown,
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, error: invalidProfileUrl };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    const url = new URL(trimmed);
    const isOfficialProfile =
      (url.hostname === 'lin.ee' && url.pathname !== '/') ||
      (url.hostname === 'line.me' &&
        url.pathname.startsWith('/R/ti/p/@') &&
        url.pathname.length > '/R/ti/p/@'.length);
    if (
      url.protocol !== 'https:' ||
      !isOfficialProfile ||
      url.port !== '' ||
      url.username ||
      url.password
    ) {
      return { ok: false, error: invalidProfileUrl };
    }
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false, error: invalidProfileUrl };
  }
}
