import { useEffect, useState } from 'react';
import liff from '@line/liff';
import Card from './ui/Card.js';

/*
 * 会員証の段（G5-3 板 I2pkdP）。マイル・紹介の画面の上に、今のランク・次の段まで・下がる予定を出す。
 * 受け口は GET /api/liff/member-card（本人の LINE ID token）。ランクを動かしていない店・まだ段が無い人は null で、何も出さない。
 * 会員番号と特典の 1 行は、この受け口がまだ返さないので出さない。
 */
const BASE = import.meta.env.VITE_API_BASE ?? '';

export interface MemberCardData {
  name: string;
  since: string;
  downgradeDueAt: string | null;
  next: { name: string; remaining: number; metric: 'visits' | 'amount' | 'miles' } | null;
}

const UNIT = { visits: '回の来店', amount: '円の購入', miles: 'マイル' } as const;
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

export async function fetchMemberCard(): Promise<MemberCardData | null> {
  const idToken = liff.getIDToken();
  if (!idToken) throw new Error('LINEで開き直してください');
  const url = new URL(`${BASE}/api/liff/member-card`, window.location.origin);
  url.searchParams.set('liffId', liff.id ?? '');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (!response.ok) throw new Error('member-card');
  const body = (await response.json()) as { success: boolean; data: MemberCardData | null };
  return body.success ? body.data : null;
}

export function MemberCardView({ card }: { card: MemberCardData }) {
  const goal = card.next && card.next.remaining > 0 ? `${card.next.name}まで あと ${card.next.remaining.toLocaleString()} ${UNIT[card.next.metric]}` : card.next ? `${card.next.name}の条件を満たしています` : '最上位のランクです';
  return <section aria-label="会員証" className="space-y-3">
    <Card className="space-y-2 p-4">
      <p className="text-xs text-ink-secondary">会員証</p>
      <p className="text-2xl font-bold text-ink">{card.name}</p>
      <p className="text-sm font-bold text-ink">{goal}</p>
    </Card>
    {card.downgradeDueAt ? <Card className="space-y-1 p-4">
      <p className="text-xs text-ink-secondary">ランクが下がる前のお知らせ</p>
      <p className="text-sm text-ink">{`${md(card.downgradeDueAt)} までに条件を満たすと、${card.name}のままです。`}</p>
    </Card> : null}
  </section>;
}

export default function MemberCard() {
  const [card, setCard] = useState<MemberCardData | null>(null);
  useEffect(() => {
    let alive = true;
    fetchMemberCard().then((data) => { if (alive) setCard(data); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return card ? <MemberCardView card={card} /> : null;
}
