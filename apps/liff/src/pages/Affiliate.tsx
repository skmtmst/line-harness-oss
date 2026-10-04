import liff from '@line/liff';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { LOAD_FAILED_MESSAGE, SUBMIT_FAILED_MESSAGE, logFailure } from '../lib/user-message.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';
import HelpTip from '../components/HelpTip.js';
import Button from '../components/ui/Button.js';
import Card from '../components/ui/Card.js';
import Badge from '../components/ui/Badge.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import Icon from '../components/ui/Icon.js';

const BASE = import.meta.env.VITE_API_BASE ?? '';

interface AffiliateData {
  id: string;
  name: string;
  code: string;
  commissionRate: number;
  isActive: boolean;
  friendId: string;
}

interface AffiliateLinkData {
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

interface OfferData {
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

interface MileageWalletData {
  mileage: MileageData;
  history: MileageHistoryItem[];
  insights: MileageInsights;
  opportunities: MileageOpportunity[];
}

interface MileageOpportunity {
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

type State =
  | { phase: 'loading' }
  | { phase: 'not_registered' }
  | { phase: 'registered'; affiliate: AffiliateData; links: AffiliateLinkData[]; offers: OfferData[] }
  | { phase: 'error'; message: string };

async function getAccessToken(): Promise<string> {
  const token = liff.getAccessToken();
  if (!token) throw new Error('LINE アクセストークンを取得できませんでした');
  return token;
}

async function fetchMe(): Promise<
  | { registered: true; affiliate: AffiliateData; links: AffiliateLinkData[] }
  | { registered: false }
> {
  const token = await getAccessToken();
  const url = `${BASE}/api/liff/affiliate/me?lineAccessToken=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (res.status === 404) return { registered: false };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  const data = (await res.json()) as { affiliate: AffiliateData; links: AffiliateLinkData[] };
  return { registered: true, affiliate: data.affiliate, links: data.links };
}

async function postRegister(): Promise<{ affiliate: AffiliateData; links: AffiliateLinkData[] }> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  return (await res.json()) as { affiliate: AffiliateData; links: AffiliateLinkData[] };
}

async function postAddLink(label: string | null, offerId: string | null): Promise<AffiliateLinkData> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token, label: label || null, offerId: offerId || null }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  const data = (await res.json()) as { link: AffiliateLinkData };
  return data.link;
}

async function fetchOffers(): Promise<OfferData[]> {
  const token = await getAccessToken();
  const url = `${BASE}/api/liff/affiliate/offers?lineAccessToken=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { offers: OfferData[] };
  return data.offers;
}

async function fetchMileage(): Promise<MileageWalletData> {
  const token = await getAccessToken();
  const url = `${BASE}/api/liff/mileage/me?lineAccessToken=${encodeURIComponent(token)}&limit=20`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  return (await res.json()) as MileageWalletData;
}

async function postEnrollOffer(offerId: string): Promise<AffiliateLinkData> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/offers/${encodeURIComponent(offerId)}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  const data = (await res.json()) as { link: AffiliateLinkData };
  return data.link;
}

/**
 * Copy `text` with graceful degradation for LIFF WebViews:
 *   1. navigator.clipboard.writeText  — modern, needs secure context + permission
 *   2. document.execCommand('copy')   — legacy textarea-select fallback
 *   3. neither worked → caller shows the URL selected for manual copy
 * Returns true only when the browser confirms the copy succeeded.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch {
    // fall through to manual-copy fallback
  }

  return false;
}

function CopyButton({ url, urlRef }: { url: string; urlRef: RefObject<HTMLInputElement | null> }) {
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);

  async function handleCopy() {
    const ok = await copyText(url);
    if (ok) {
      setManualCopy(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    setManualCopy(true);
    setTimeout(() => {
      const el = urlRef.current;
      if (el) {
        el.focus();
        el.select();
        el.setSelectionRange(0, el.value.length);
      }
    }, 0);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-hairline bg-canvas px-3 text-xs font-bold text-ink"
      >
        <Icon name="copy" className="h-3.5 w-3.5" />
        {copied ? 'コピー済み' : 'コピー'}
      </button>
      {manualCopy && (
        <div className="w-full space-y-1">
          <p className="text-xs text-ink-secondary">
            自動コピーできませんでした。下のURLを選択してコピーしてください。
          </p>
          <input
            ref={urlRef}
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-xs text-ink"
          />
        </div>
      )}
    </>
  );
}

const rewardText = (amount: number) =>
  amount > 0 ? `1件 ¥${amount.toLocaleString()}` : '報酬未設定';

function formatMileageDate(value: string): string {
  const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10).replaceAll('-', '/');
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function mileageSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    webinar: 'ウェビナー',
    instagram: 'Instagram',
    line: 'LINE',
    line_relationship: 'LINE継続',
    booking: '予約',
    form: 'フォーム',
    stripe: '購入',
    tag: 'タグ',
    tag_referral: '紹介',
    affiliate: '紹介',
    admin: '運営',
  };
  return labels[source] ?? source;
}

/**
 * 貯まったマイル (白地に緑の数のカード。オーナー「黒がいや」)。
 * 使えるマイル・確定待ち・内訳4つ・合算の注記を出す。
 */
function MileageSummaryCard({ wallet }: { wallet: MileageWalletData }) {
  const { mileage, insights } = wallet;
  return (
    <section aria-label="貯まったマイル" className="rounded-2xl border border-hairline bg-canvas p-[18px] text-ink">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-ink-secondary">使えるマイル</p>
        {mileage.pending > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-liff-soft px-2.5 py-1 text-xs font-bold whitespace-nowrap text-liff-primary">
            確定待ち {mileage.pending.toLocaleString()}
            <HelpTip label="確定待ちの説明" align="right">条件の確定を待っているマイルです。</HelpTip>
          </span>
        )}
      </div>
      <p className="mt-3 text-4xl font-bold tracking-tight tabular-nums text-liff-primary">
        {mileage.available.toLocaleString()}
        <span className="ml-1 text-[13px] text-ink-secondary">マイル</span>
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-liff-soft p-3">
          <p className="text-[11px] text-ink-secondary">これまでに得た</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-liff-primary">{mileage.lifetimeEarned.toLocaleString()}</p>
        </div>
        <div className="rounded-xl bg-liff-soft p-3">
          <p className="text-[11px] text-ink-secondary">紹介で得た</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-liff-primary">{insights.referralMiles.toLocaleString()}</p>
        </div>
        <div className="rounded-xl bg-liff-soft p-3">
          <p className="text-[11px] text-ink-secondary">使った</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-liff-primary">{mileage.spent.toLocaleString()}</p>
        </div>
        <div className="rounded-xl bg-liff-soft p-3">
          <p className="text-[11px] text-ink-secondary">良質な紹介</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-liff-primary">{insights.qualityReferralCount.toLocaleString()}人</p>
        </div>
      </div>

      {insights.accountCount > 1 && (
        <p className="mt-3 text-xs leading-relaxed text-ink-secondary">
          {insights.accountCount}個のLINE公式アカウントで貯めたマイルを合算しています
        </p>
      )}
    </section>
  );
}

/** 1つの取り組みの行。まだの分は行き先へのボタンも出す (動きを残す)。 */
function OpportunityCta({ item, secondary = false }: { item: MileageOpportunity; secondary?: boolean }) {
  return (
    <a
      href={item.url}
      className={
        secondary
          ? 'mt-3 block rounded-lg border border-hairline bg-canvas py-2.5 text-center text-sm font-bold text-ink'
          : 'mt-3 block rounded-lg bg-liff-primary py-3 text-center text-sm font-bold text-white'
      }
    >
      {item.ctaLabel}
    </a>
  );
}

/**
 * 今、マイルを増やせます＋LINEアカウント登録マイル (6-a の下)。
 * ウェビナーの取り組み (進み具合・行き先) と、
 * アカウントごとの登録の様子 (登録済み・確定待ち) を出す。
 */
function MileageOpportunities({ items }: { items: MileageOpportunity[] }) {
  if (items.length === 0) return null;

  const accountItems = items.filter((item) => item.type === 'friend_add');
  const webinarItems = items.filter((item) => item.type === 'webinar');

  return (
    <div className="space-y-5">
      {webinarItems.length > 0 && (
        <section aria-label="今、マイルを増やせます" className="space-y-3">
          <h2 className="px-1 text-sm font-bold text-ink">今、マイルを増やせます</h2>
          <Card className="divide-y divide-hairline px-4 py-1">
            {webinarItems.map((item) => (
              <div key={item.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-ink" title={item.title}>
                    {item.title}
                  </h3>
                  <span className="shrink-0 rounded-full bg-ok-bg px-2.5 py-1 text-xs font-bold whitespace-nowrap text-ok-ink tabular-nums">
                    +{item.rewardMiles.toLocaleString()} マイル
                  </span>
                </div>
                {item.description && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-faint">{item.description}</p>
                )}
                {item.progressPercent > 0 && (
                  <div className="mt-2">
                    <div className="mb-1 flex justify-between text-xs text-ink-faint tabular-nums">
                      <span>現在の視聴進捗</span>
                      <span>{item.progressPercent}%</span>
                    </div>
                    <div
                      className="h-1.5 overflow-hidden rounded-full bg-ground"
                      role="progressbar"
                      aria-valuenow={item.progressPercent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${item.title}の視聴進捗`}
                    >
                      <span className="block h-full rounded-full bg-liff-primary" style={{ width: `${item.progressPercent}%` }} />
                    </div>
                  </div>
                )}
                <OpportunityCta item={item} secondary />
              </div>
            ))}
          </Card>
        </section>
      )}

      {accountItems.length > 0 && (
        <section aria-label="LINEアカウント登録マイル" className="space-y-3">
          <h2 className="px-1 text-sm font-bold text-ink">LINEアカウント登録マイル</h2>
          <Card className="divide-y divide-hairline px-4 py-1">
            {accountItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 py-3">
                <h3 className="min-w-0 flex-1 truncate text-sm text-ink" title={item.title}>
                  {item.title}
                </h3>
                {item.completed ? (
                  item.mileageStatus === 'credited' ? (
                    <Badge tone="confirmed">
                      {`加算済み +${(item.creditedMiles ?? item.rewardMiles).toLocaleString()}`}
                    </Badge>
                  ) : item.mileageStatus === 'pending' ? (
                    <Badge tone="pending">確定待ち</Badge>
                  ) : (
                    <Badge tone="confirmed">登録済み</Badge>
                  )
                ) : (
                  <a
                    href={item.url}
                    className="shrink-0 rounded-full bg-ok-bg px-2.5 py-1 text-xs font-bold whitespace-nowrap text-ok-ink tabular-nums"
                  >
                    +{item.rewardMiles.toLocaleString()} マイル
                  </a>
                )}
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

/** マイル履歴 (6-a の下。開いた一覧で出す)。 */
function MileageHistory({ wallet }: { wallet: MileageWalletData }) {
  const { history } = wallet;
  return (
    <section aria-label="マイル履歴" className="space-y-3">
      <div className="px-1">
        <h2 className="flex items-center gap-1 text-sm font-bold text-ink">
          マイル履歴
          <HelpTip label="マイル履歴の説明">行動後、定期集計で反映されます。確定待ちは条件の確定待ち、取消は取り消されたものです。</HelpTip>
        </h2>
        <p className="mt-0.5 text-xs text-ink-faint">行動のあと、決まった時間にまとめて反映されます</p>
      </div>
      <Card className="px-4 py-1">
        {history.length === 0 ? (
          <p className="py-6 text-center text-xs leading-relaxed text-ink-faint">
            LINEやウェビナーで行動すると、ここにマイル履歴が表示されます
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {history.map((item) => (
              <li key={item.id} className={`flex items-center justify-between gap-3 py-3 ${item.status === 'void' ? 'opacity-50' : ''}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink" title={item.reason}>
                    {item.reason}
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint">
                    <span>{formatMileageDate(item.occurredAt)}</span>
                    <span>{mileageSourceLabel(item.source)}</span>
                    {item.status === 'pending' && <Badge tone="pending">確定待ち</Badge>}
                    {item.status === 'void' && <span>取消</span>}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-sm font-bold whitespace-nowrap tabular-nums ${item.amount < 0 ? 'text-ink' : 'text-ok-ink'}`}
                >
                  {item.amount > 0 ? `+${item.amount.toLocaleString()}` : item.amount.toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

/** 紹介の成果 (6-b の上)。3つの数と、追加マイルの対象の注記。 */
function ReferralSummary({ links }: { links: AffiliateLinkData[] }) {
  const totals = links.reduce(
    (sum, link) => ({
      clicks: sum.clicks + link.clickCount,
      friendAdds: sum.friendAdds + link.friendAdds,
      approved: sum.approved + link.conversionsApproved,
    }),
    { clicks: 0, friendAdds: 0, approved: 0 },
  );

  return (
    <section aria-label="紹介の成果" className="space-y-3">
      <div className="px-1">
        <h2 className="text-sm font-bold text-ink">紹介の成果</h2>
        <p className="mt-0.5 text-xs text-ink-faint">
          紹介した友だちが予約・視聴・購入へ進むと、追加マイルの対象になります
        </p>
      </div>
      <Card className="grid grid-cols-3 gap-2 p-3">
        <div className="rounded-lg bg-ground px-2 py-3 text-center">
          <p className="text-lg font-bold text-ink tabular-nums">{totals.clicks.toLocaleString()}</p>
          <p className="mt-0.5 text-xs whitespace-nowrap text-ink-faint">開いた</p>
        </div>
        <div className="rounded-lg bg-ground px-2 py-3 text-center">
          <p className="text-lg font-bold text-ink tabular-nums">{totals.friendAdds.toLocaleString()}</p>
          <p className="mt-0.5 text-xs whitespace-nowrap text-ink-faint">友だち追加</p>
        </div>
        <div className="rounded-lg bg-ground px-2 py-3 text-center">
          <p className="text-lg font-bold text-ink tabular-nums">{totals.approved.toLocaleString()}</p>
          <p className="mt-0.5 text-xs whitespace-nowrap text-ink-faint">成果になった</p>
        </div>
      </Card>
    </section>
  );
}

/**
 * 1本の紹介リンク (案件の中・その他のリンク)。
 * 名前・URL・写しボタン・そのリンクの成果の数を出す。
 */
function LinkRow({ link }: { link: AffiliateLinkData }) {
  const urlRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-lg bg-ground p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-sm font-bold text-ink" title={link.label ?? 'リンク'}>
            <Icon name="link" className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
            {link.label ?? 'リンク'}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-faint" title={link.url}>
            {link.url}
          </p>
        </div>
        <CopyButton url={link.url} urlRef={urlRef} />
      </div>
      <p className="mt-2 text-xs whitespace-nowrap text-ink-faint tabular-nums">
        開いた {link.clickCount}・友だち追加 {link.friendAdds}・成果 {link.conversionsApproved}・審査中 {link.conversionsPending}
      </p>
    </div>
  );
}

/**
 * 「SNSごとのリンクを発行」の小さな書き足し欄。
 * 案件のカードの中に置き、案件に対してリンクを作る。
 */
function AddOfferLinkForm({
  offerId,
  atLimit,
  onAdded,
}: {
  offerId: string;
  atLimit: boolean;
  onAdded: (link: AffiliateLinkData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const link = await postAddLink(label.trim() || null, offerId);
      onAdded(link);
      setLabel('');
      setOpen(false);
    } catch (e) {
      logFailure('affiliate-add-link', e);
      setError(SUBMIT_FAILED_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  if (atLimit) {
    return <p className="text-xs font-bold text-danger">リンクの上限（20本）に達しています</p>;
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        ＋ SNSごとのリンクを発行
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="例: X用、Instagram用"
        className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
        disabled={busy}
      />
      {error && <p className="text-xs font-bold text-danger">{error}</p>}
      <div className="flex gap-2">
        <div className="flex-1">
          <Button variant="primary" onClick={handleAdd} disabled={busy}>
            {busy ? '発行中…' : 'リンクを発行'}
          </Button>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
          className="shrink-0 px-4 text-sm text-ink-faint disabled:opacity-50"
        >
          やめる
        </button>
      </div>
    </div>
  );
}

/**
 * 1つの案件のカード。入っている案件はその案件のリンクと書き足し欄、
 * まだの案件は売り文句 (説明・報酬) と参加ボタンを出す。
 */
function OfferCard({
  offer,
  offerLinks,
  atLimit,
  totalLinks,
  onEnrolled,
  onLinkAdded,
}: {
  offer: OfferData;
  offerLinks: AffiliateLinkData[];
  atLimit: boolean;
  totalLinks: number;
  onEnrolled: (link: AffiliateLinkData) => void;
  onLinkAdded: (link: AffiliateLinkData) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enrollCalledRef = useRef(false);

  async function handleEnroll() {
    if (busy || enrollCalledRef.current) return;
    enrollCalledRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const link = await postEnrollOffer(offer.id);
      onEnrolled(link);
    } catch (e) {
      logFailure('affiliate-enroll', e);
      // 上限で止まった受付だけ、サーバーの文言をそのまま出す(PR823)。
      // それ以外の失敗は定型文にする(技術的な文言を出さない)。
      const message = e instanceof Error ? e.message : ''
      setError(message.includes('上限に達したため終了') ? message : SUBMIT_FAILED_MESSAGE);
    } finally {
      setBusy(false);
      enrollCalledRef.current = false;
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-ink" title={offer.name}>
            {offer.name}
          </h3>
          {offer.description && (
            <p className="mt-1 text-xs leading-relaxed text-ink-faint">{offer.description}</p>
          )}
        </div>
        <p className="shrink-0 text-xs font-bold whitespace-nowrap text-ok-ink tabular-nums">
          {rewardText(offer.rewardAmount)}
          {offer.rewardMiles > 0 && ` +${offer.rewardMiles.toLocaleString()}マイル`}
        </p>
      </div>

      {offer.halted ? (
        <p className="text-xs font-bold text-danger">受付は終了しました（上限に達したため）</p>
      ) : offer.totalRemaining != null && offer.totalRemaining > 0 ? (
        <p className="text-xs text-ink-faint tabular-nums">上限まであと{offer.totalRemaining}件</p>
      ) : null}

      {offer.enrolled ? (
        <div className="space-y-2">
          {offerLinks.length > 0 ? (
            offerLinks.map((l) => <LinkRow key={l.refCode} link={l} />)
          ) : (
            <p className="py-1 text-xs text-ink-faint">
              リンクを追加すると紹介を始められます
            </p>
          )}
          <AddOfferLinkForm offerId={offer.id} atLimit={atLimit} onAdded={onLinkAdded} />
          <p className="text-xs text-ink-faint tabular-nums">
            リンクは20本まで作れます（いま{totalLinks}本）
          </p>
        </div>
      ) : (
        <>
          {error && <p className="text-xs font-bold text-danger">{error}</p>}
          <Button variant="primary" onClick={handleEnroll} disabled={busy}>
            {busy ? '参加中…' : 'この案件に参加する'}
          </Button>
        </>
      )}
    </Card>
  );
}

export default function Affiliate() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [wallet, setWallet] = useState<MileageWalletData | null>(null);
  const [registerBusy, setRegisterBusy] = useState(false);
  // registerCalledRef guards against a double-tap firing two POSTs while the
  // first is in flight. It is released in `finally` so that a *failed* register
  // can be retried — the button intentionally becomes clickable again on error.
  const registerCalledRef = useRef(false);

  const loadMe = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const [result, mileageResult] = await Promise.all([fetchMe(), fetchMileage()]);
      setWallet(mileageResult);
      if (result.registered) {
        const offers = await fetchOffers().catch(() => []);
        setState({ phase: 'registered', affiliate: result.affiliate, links: result.links, offers });
      } else {
        setState({ phase: 'not_registered' });
      }
    } catch (e) {
      logFailure('affiliate-load', e);
      setState({ phase: 'error', message: LOAD_FAILED_MESSAGE });
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  async function handleRegister() {
    if (registerBusy || registerCalledRef.current) return;
    registerCalledRef.current = true;
    setRegisterBusy(true);
    try {
      const data = await postRegister();
      const offers = await fetchOffers().catch(() => []);
      setState({ phase: 'registered', affiliate: data.affiliate, links: data.links, offers });
    } catch (e) {
      logFailure('affiliate-register', e);
      setState({ phase: 'error', message: LOAD_FAILED_MESSAGE });
    } finally {
      // Release on both success and failure: success repaints to the registered
      // view (button gone), failure repaints to the error view whose retry path
      // re-runs loadMe → not_registered, so allowing another attempt is correct.
      setRegisterBusy(false);
      registerCalledRef.current = false;
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="min-h-screen bg-ground">
        <div className="mx-auto w-full max-w-md px-4 pt-4">
          <LoadingView />
        </div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="min-h-screen bg-ground">
        <div className="mx-auto w-full max-w-md px-4 pt-4">
          <LoadErrorView message={state.message} onRetry={() => void loadMe()} />
        </div>
      </div>
    );
  }

  if (state.phase === 'not_registered') {
    return (
      <div className="min-h-screen bg-ground" data-design-node="S3uBl">
        <LiffHeader title="マイル・紹介" />
        <div className="mx-auto w-full max-w-md space-y-5 px-4 pt-3 pb-12">
          {wallet && <MileageSummaryCard wallet={wallet} />}
          {wallet && <MileageOpportunities items={wallet.opportunities} />}
          <Card className="space-y-3 p-4 text-center">
            <span
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ok-bg text-ok-ink"
              aria-hidden="true"
            >
              <Icon name="share-2" className="h-7 w-7" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-ink">紹介リンクを使う</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                無料で登録すると、案件ごと・SNSごとの紹介リンクを作れます。紹介した友だちが予約や購入へ進むと、マイルが増えます。
              </p>
            </div>
            <Button variant="primary" onClick={handleRegister} disabled={registerBusy}>
              {registerBusy ? '登録中…' : 'はじめる（無料）'}
            </Button>
          </Card>
          {wallet && <MileageHistory wallet={wallet} />}
        </div>
      </div>
    );
  }

  // registered
  const { links, offers } = state;
  const atLimit = links.length >= 20;

  // Newest-first from the API; render oldest-first inside each offer so a stable
  // reading order matches issuance order.
  const orderedLinks = [...links].reverse();
  const linksByOffer = new Map<string, AffiliateLinkData[]>();
  const genericLinks: AffiliateLinkData[] = [];
  for (const l of orderedLinks) {
    if (l.offerId) {
      const arr = linksByOffer.get(l.offerId) ?? [];
      arr.push(l);
      linksByOffer.set(l.offerId, arr);
    } else {
      genericLinks.push(l);
    }
  }

  const enrolledOffers = offers.filter((o) => o.enrolled);
  const availableOffers = offers.filter((o) => !o.enrolled);

  function handleOfferEnrolled(newLink: AffiliateLinkData) {
    setState((prev) => {
      if (prev.phase !== 'registered') return prev;
      const updatedOffers = prev.offers.map((o) =>
        o.id === newLink.offerId
          ? { ...o, enrolled: true, refCode: newLink.refCode, url: newLink.url }
          : o,
      );
      return { ...prev, links: [...prev.links, newLink], offers: updatedOffers };
    });
  }

  function handleLinkAdded(newLink: AffiliateLinkData) {
    setState((prev) => {
      if (prev.phase !== 'registered') return prev;
      return { ...prev, links: [...prev.links, newLink] };
    });
  }

  // 並びは S3uBl のとおり「貯まった → 増やす → 紹介の成果」。
  return (
    <div className="min-h-screen bg-ground" data-design-node="S3uBl">
      <LiffHeader title="マイル・紹介" />
      <div className="mx-auto w-full max-w-md space-y-5 px-4 pt-3 pb-12">

        {wallet && <MileageSummaryCard wallet={wallet} />}

        {wallet && <MileageOpportunities items={wallet.opportunities} />}

        {wallet && <MileageHistory wallet={wallet} />}

        <ReferralSummary links={links} />

        {enrolledOffers.length > 0 && (
          <section aria-label="参加中の案件" className="space-y-3">
            <h2 className="px-1 text-xs font-semibold text-ink-faint">参加中の案件</h2>
            {enrolledOffers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                offerLinks={linksByOffer.get(offer.id) ?? []}
                atLimit={atLimit}
                totalLinks={links.length}
                onEnrolled={handleOfferEnrolled}
                onLinkAdded={handleLinkAdded}
              />
            ))}
          </section>
        )}

        {availableOffers.length > 0 && (
          <section aria-label="参加できる案件" className="space-y-3">
            <h2 className="px-1 text-xs font-semibold text-ink-faint">参加できる案件</h2>
            {availableOffers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                offerLinks={[]}
                atLimit={atLimit}
                totalLinks={links.length}
                onEnrolled={handleOfferEnrolled}
                onLinkAdded={handleLinkAdded}
              />
            ))}
          </section>
        )}

        {genericLinks.length > 0 && (
          <section aria-label="その他のリンク" className="space-y-3">
            <div className="px-1">
              <h2 className="px-1 text-xs font-semibold text-ink-faint">その他のリンク</h2>
              <p className="mt-0.5 px-1 text-xs text-ink-faint">案件に結びつかない、前から使っているリンク</p>
            </div>
            <Card className="space-y-2 p-3">
              {genericLinks.map((link) => (
                <LinkRow key={link.refCode} link={link} />
              ))}
            </Card>
          </section>
        )}

        {offers.length === 0 && genericLinks.length === 0 && (
          <Card className="p-4 text-center text-sm text-ink-faint">
            現在参加できる案件はありません
          </Card>
        )}
      </div>
    </div>
  );
}
