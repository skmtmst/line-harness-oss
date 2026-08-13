const RESERVED_OAUTH_PARAMS = new Set([
  'code',
  'state',
  'liffClientId',
  'liffRedirectUri',
  'liff.state',
  'error',
  'error_description',
]);

/**
 * LINE redirects LIFF URLs through the registered endpoint and stores the
 * original query string in `liff.state`. Restore those application parameters
 * without replacing OAuth callback parameters or explicit URL values.
 */
export function mergeLiffStateSearch(search: string): string {
  const params = new URLSearchParams(search);
  const liffState = params.get('liff.state');
  if (!liffState) return search;

  const stateParams = new URLSearchParams(liffState.startsWith('?') ? liffState.slice(1) : liffState);
  for (const [key, value] of stateParams) {
    if (!key || RESERVED_OAUTH_PARAMS.has(key) || params.has(key)) continue;
    params.append(key, value);
  }

  const merged = params.toString();
  return merged ? `?${merged}` : '';
}

export function restoreLiffStateInCurrentUrl(): void {
  const mergedSearch = mergeLiffStateSearch(window.location.search);
  if (mergedSearch === window.location.search) return;
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${mergedSearch}${window.location.hash}`,
  );
}
