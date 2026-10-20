import { readApiError } from '@line-crm/shared';
import { responseLiffError, liffErrorMessage } from './api-error.js';
import liff from '@line/liff';
import { fetchAffiliateSelf } from './affiliate-self-fetch.js';

const BASE = import.meta.env.VITE_API_BASE ?? '';
export interface Reward {
  id: string; name: string; description: string | null; imageUrl: string | null;
  currentVersion: { requiredMiles: number } | null;
  canRedeem: boolean; unavailableReason: string | null;
}
export interface Redemption {
  status: 'succeeded' | 'delivery_failed'; rewardName: string;
  customerMessage: string; rewardCode: string | null; message: string | null;
}
export interface BankInput {
  bankCode: string; bankName: string; branchCode: string; branchName: string;
  accountType: 'ordinary' | 'checking'; accountNumber: string; accountHolderName: string;
}
export interface BankProfile extends Omit<BankInput, 'accountNumber'> {
  accountLast4: string; version: number;
}
export interface Statement {
  id: string; totalAmount: number; createdAt: string; expiresAt: string | null;
}
let embeddedAccessToken: string | null = null;
export function setAffiliateAccessToken(value: string | null): void { embeddedAccessToken = value; }
function token() {
  const value = embeddedAccessToken ?? liff.getAccessToken();
  if (!value) throw new Error('LINEで開き直してください');
  return value;
}
export class SelfApiError extends Error {
  constructor(public status: number, public fields: Record<string, string>, message: string, public code?: string, public requestId?: string) { super(message); }
}
async function request<T>(path: string, method = 'GET', body?: object, key?: string): Promise<T> {
  const accessToken = token();
  const url = new URL(`${BASE}/api/liff/${path}`, window.location.origin);
  const response = method === 'GET' ? await fetchAffiliateSelf(path, accessToken) : await fetch(url, {
    method, headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify({ ...body, lineAccessToken: accessToken }) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    const detail = readApiError(result);
    throw new SelfApiError(response.status, detail.fields, liffErrorMessage(result), detail.code, detail.requestId ?? response.headers.get('X-Request-ID') ?? undefined);
  }
  return result as T;
}
export const affiliateSelfApi = {
  rewards: () => request<{ rewards: Reward[]; availableMiles: number }>('mileage/rewards'),
  redeem: (id: string, key: string) => request<Redemption>(`mileage/rewards/${encodeURIComponent(id)}/redeem`, 'POST', {}, key),
  bank: () => request<{ data: BankProfile | null }>('affiliate/bank').then(r => r.data),
  saveBank: (body: BankInput, expectedVersion: number, key: string) =>
    request<{ data: BankProfile }>('affiliate/bank', 'PUT', { ...body, expectedVersion }, key).then(r => r.data),
  statements: () => request<{ data: Statement[] }>('affiliate/statements').then(r => r.data),
  download: async (id: string) => {
    const url = new URL(`${BASE}/api/liff/affiliate/statements/${encodeURIComponent(id)}/download`, window.location.origin);
    url.searchParams.set('issue', '1');
    const headers = { Authorization: `Bearer ${token()}` };
    const issued = await fetch(url, { headers, cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
    if (!issued.ok) throw await responseLiffError(issued);
    const result = await issued.json() as { data: { url: string } };
    const signed = new URL(result.data.url);
    if (signed.origin !== url.origin || signed.pathname !== url.pathname || signed.searchParams.has('lineAccessToken')) throw new Error('取得用URLが無効です');
    const response = await fetch(signed, { headers, cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
    if (!response.ok) throw await responseLiffError(response);
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = blobUrl; link.download = `statement-${id}.pdf`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  },
};
