import liff from '@line/liff';

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
  constructor(public status: number, public fields: Record<string, string>, message: string) { super(message); }
}
async function request<T>(path: string, method = 'GET', body?: object, key?: string): Promise<T> {
  const accessToken = token();
  const url = new URL(`${BASE}/api/liff/${path}`, window.location.origin);
  if (method === 'GET') url.searchParams.set('lineAccessToken', accessToken);
  const response = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify({ ...body, lineAccessToken: accessToken }) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new SelfApiError(response.status, result.fields ?? {},
    /[ぁ-んァ-ン一-龥]/.test(result.error ?? '') ? result.error : '処理できませんでした。もう一度お試しください。');
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
    url.searchParams.set('lineAccessToken', token());
    const response = await fetch(url);
    if (!response.ok) throw new Error('支払明細を取得できませんでした。もう一度お試しください。');
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = blobUrl; link.download = `statement-${id}.pdf`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  },
};
