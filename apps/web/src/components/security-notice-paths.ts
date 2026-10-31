const SECURITY_NOTICE_PINNED_PATHS = new Set(['/', '/settings', '/hq/settings', '/ops', '/ops/dashboard'])
export function isSecurityNoticePinned(pathname: string | null) {
  return pathname !== null && SECURITY_NOTICE_PINNED_PATHS.has(pathname)
}
