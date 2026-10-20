import { responseLiffError } from './api-error.js';
import liff from '@line/liff';
import { fetchAffiliateSelf } from './affiliate-self-fetch.js';
const BASE = import.meta.env.VITE_API_BASE ?? '';

export interface AffiliateData {
  id: string;
  name: string;
  code: string;
  commissionRate: number;
  isActive: boolean;
  friendId: string;
}

export interface AffiliateLinkData {
  refCode: string;
  label: string | null;
  url: string;
  clickCount: number;
  friendAdds: number;
  conversions: number;
  conversionsPending: number;
  conversionsApproved: number;
  offerId: string | null;
  offerName: string | null;
}

export interface OfferData {
  id: string;
  name: string;
  description: string | null;
  rewardAmount: number;
  rewardMiles: number;
  windowDays: number | null;
  receptionFrom: string | null;
  receptionTo: string | null;
  /** 上限に達して受付が止まっているか。(PR823) */
  halted: boolean;
  totalRemaining: number | null;
  monthlyRemaining: number | null;
  enrolled: boolean;
  refCode: string | null;
  url: string | null;
}

interface MileageData {
  programId: string;
  programName: string;
  available: number;
  pending: number;
  lifetimeEarned: number;
  spent: number;
}

interface MileageHistoryItem {
  id: string;
  entryType: 'grant' | 'reversal' | 'spend' | 'expiration' | 'adjustment';
  status: 'pending' | 'available' | 'void';
  amount: number;
  reason: string;
  source: string;
  sourceEventId: string | null;
  occurredAt: string;
}

interface MileageInsights {
  accountCount: number;
  rewardedActions: number;
  referralMiles: number;
  qualityReferralCount: number;
  lastEarnedAt: string | null;
}

export interface MileageWalletData {
  mileage: MileageData;
  history: MileageHistoryItem[];
  insights: MileageInsights;
  opportunities: MileageOpportunity[];
}

export interface MileageOpportunity {
  id: string;
  type: 'webinar' | 'friend_add';
  title: string;
  description: string;
  rewardMiles: number;
  nextRewardMiles: number;
  progressPercent: number;
  ctaLabel: string;
  url: string;
  targetAccountId?: string;
  completed?: boolean;
  mileageStatus?: 'credited' | 'pending' | 'waiting';
  creditedMiles?: number;
}

async function getAccessToken(): Promise<string> {
  const token = liff.getAccessToken();
  if (!token) throw new Error('LINE アクセストークンを取得できませんでした');
  return token;
}

export async function fetchMe(): Promise<
  | { registered: true; affiliate: AffiliateData; links: AffiliateLinkData[] }
  | { registered: false }
> {
  const token = await getAccessToken();
  const res = await fetchAffiliateSelf('affiliate/me', token);
  if (res.status === 404) return { registered: false };
  if (!res.ok) {
    throw await responseLiffError(res);
  }
  const data = (await res.json()) as { affiliate: AffiliateData; links: AffiliateLinkData[] };
  return { registered: true, affiliate: data.affiliate, links: data.links };
}

export async function postRegister(): Promise<{ affiliate: AffiliateData; links: AffiliateLinkData[] }> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token }),
  });
  if (!res.ok) {
    throw await responseLiffError(res);
  }
  return (await res.json()) as { affiliate: AffiliateData; links: AffiliateLinkData[] };
}

export async function postAddLink(label: string | null, offerId: string | null): Promise<AffiliateLinkData> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token, label: label || null, offerId: offerId || null }),
  });
  if (!res.ok) {
    throw await responseLiffError(res);
  }
  const data = (await res.json()) as { link: AffiliateLinkData };
  return data.link;
}

export async function fetchOffers(): Promise<OfferData[]> {
  const token = await getAccessToken();
  const res = await fetchAffiliateSelf('affiliate/offers', token);
  if (!res.ok) throw new Error('案件を読み込めませんでした。');
  const data = (await res.json()) as { offers: OfferData[] };
  return data.offers;
}

export async function fetchMileage(): Promise<MileageWalletData> {
  const token = await getAccessToken();
  const res = await fetchAffiliateSelf('mileage/me?limit=20', token);
  if (!res.ok) {
    throw await responseLiffError(res);
  }
  return (await res.json()) as MileageWalletData;
}

export async function postEnrollOffer(offerId: string): Promise<AffiliateLinkData> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/offers/${encodeURIComponent(offerId)}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token }),
  });
  if (!res.ok) {
    throw await responseLiffError(res);
  }
  const data = (await res.json()) as { link: AffiliateLinkData };
  return data.link;
}
