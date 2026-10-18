/** Reject browser-normalized external paths, including encoded controls. */
export function safeNavigationPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return null
  try {
    const decoded = decodeURIComponent(value.split(/[?#]/)[0])
    if (decoded.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(decoded)) return null
    const origin = 'https://local.invalid'
    const url = new URL(value, origin)
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null
  } catch { return null }
}
