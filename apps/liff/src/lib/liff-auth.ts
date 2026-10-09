import { mergeLiffStateSearch } from '@line-crm/shared';
import liff from '@line/liff';

let _liffId: string | null = null;
let _lineUserId: string | null = null;
let _idToken: string | null = null;

export async function initLiff(): Promise<void> {
  const search = mergeLiffStateSearch(window.location.search);
  if (search !== window.location.search) window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
  const url = new URL(window.location.href);
  const liffId = url.searchParams.get('liffId') ?? import.meta.env.VITE_DEFAULT_LIFF_ID;
  if (!liffId) {
    throw new Error('liffId not provided. Append ?liffId=... to the URL.');
  }
  _liffId = liffId;
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }
  const profile = await liff.getProfile();
  _lineUserId = profile.userId;
  // id_token は Worker 側で LINE Login verify API を叩いて caller を確定するために使う。
  _idToken = liff.getIDToken();
}

export function getLiffId(): string {
  if (!_liffId) throw new Error('LIFF not initialized');
  return _liffId;
}

export function getLineUserId(): string {
  if (!_lineUserId) throw new Error('LIFF not initialized');
  return _lineUserId;
}

export function getIdToken(): string {
  if (!_idToken) throw new Error('LIFF not initialized or id_token not available');
  return _idToken;
}

/** Worker の既存LIFF入口で認証済みの文脈を、共用画面へ渡す。 */
export function setLiffContext(context: { liffId: string; lineUserId: string; idToken: string }): void {
  _liffId = context.liffId;
  _lineUserId = context.lineUserId;
  _idToken = context.idToken;
}
