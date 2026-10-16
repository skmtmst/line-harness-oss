export function readOfficialProfileUrl(
  value: unknown,
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, error: 'officialProfileUrl must be a https://lin.ee/ URL' };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'lin.ee' ||
      url.port !== '' ||
      url.username ||
      url.password ||
      url.pathname === '/'
    ) {
      return { ok: false, error: 'officialProfileUrl must be a https://lin.ee/ URL' };
    }
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false, error: 'officialProfileUrl must be a https://lin.ee/ URL' };
  }
}
