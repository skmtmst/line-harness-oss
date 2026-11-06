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

  const question = liffState.indexOf('?');
  const stateSearch = question >= 0 ? liffState.slice(question + 1).split('#')[0]
    : liffState.startsWith('/') ? '' : liffState;
  const stateParams = new URLSearchParams(stateSearch);
  for (const [key, value] of stateParams) {
    if (!key || RESERVED_OAUTH_PARAMS.has(key) || params.has(key)) continue;
    params.append(key, value);
  }

  const merged = params.toString();
  return merged ? `?${merged}` : '';
}

/** 予約の案内の道もSDKのstateから戻す。外部URLや未知の道へは移動しない。 */
export function mergeLiffStateLocation(pathname: string, search: string, hash = ''): string {
  const params = new URLSearchParams(search);
  const statePath = (params.get('liff.state') ?? '').split(/[?#]/)[0];
  const restoreBookingPath = pathname === '/' && !params.has('page') && (statePath === '/booking' || statePath === '/booking/history');
  return `${restoreBookingPath ? statePath : pathname}${mergeLiffStateSearch(search)}${hash}`;
}
