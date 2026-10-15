import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  api,
  visitStampsApi,
  type BookingEntitlement,
  type BookingHistoryItem,
  type NotificationPreferenceItem,
  type NotificationPreferences,
} from '../lib/api.js';
import { affiliateSelfApi } from '../lib/affiliate-self-api.js';
import { loadPaymentViews, paymentText, type PaymentView } from '../lib/booking-payment-view.js';
import { utcToJstHm, utcToJstMd, utcToJstWeekday } from '../lib/datetime.js';
import liffRuntime from '../lib/liff-runtime.js';
import { isNotReadyYet } from '../lib/not-ready.js';
import { logFailure } from '../lib/user-message.js';
import LiffLookScope from '../components/LiffLookScope.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';
import Card from '../components/ui/Card.js';
import Button from '../components/ui/Button.js';
import Icon, { type IconName } from '../components/ui/Icon.js';

/** 準備中の案内（B-314）。本物の口が来るまで、入口は置いて押すとこれを出す。 */
const COMING_SOON = '現在準備中です';

/**
 * 一覧の 1 行の状態。
 * - hidden：数の無い物は出さない（キャンセル待ち 0 件・スタンプカードが無い 等）
 * - soon：本物の口がまだ無い（回数券＝組3・クーポン）。押すと準備中の案内
 */
type RowState =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'soon' }
  | { kind: 'value'; text: string };

const LOADING: RowState = { kind: 'loading' };

/** 回数券・月謝の行の数（「残り 9 回」「今月 あと 2 回」）。 */
export function entitlementSummary(items: BookingEntitlement[]): string | null {
  const usable = items.filter((e) => e.usable);
  const first = usable[0] ?? items[0];
  if (!first) return null;
  if (first.kind === 'monthly') return `今月 あと ${first.monthRemaining ?? 0} 回`;
  return `残り ${first.remaining ?? 0} 回`;
}

function ymd(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const jst = new Date(d.getTime() + 9 * 3600_000);
  return `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

/** 回数券の 1 件の説明（期限・月謝の今月の利用）。 */
export function entitlementDetail(e: BookingEntitlement): string {
  const until = ymd(e.expiresAt);
  const head = e.kind === 'monthly'
    ? `今月 ${e.monthUsed ?? 0}／${e.monthAllowance ?? e.monthlyLimit ?? 0} 回 利用`
    : `残り ${e.remaining ?? 0} 回`;
  const tail = !e.usable ? '（使えません）' : until ? `・${until} まで` : '';
  return `${head}${tail}`;
}

/**
 * LIFF マイページ (★V8・L5g75)。
 * 次の予約（支払いの状態つき）・キャンセル待ち・回数券・スタンプ・マイル・クーポン・お知らせの受け取り。
 * 口が無い物（回数券＝組3、お知らせの受け取り＝組1・組2 の 637、クーポン）は「現在準備中です」で出す。
 */
export default function MyPage() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const go = (pathname: string) => navigate({ pathname, search });

  const [name, setName] = useState<string | null>(null);
  const [history, setHistory] = useState<{ upcoming: BookingHistoryItem[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [nextPayment, setNextPayment] = useState<PaymentView | null>(null);
  const [waitlist, setWaitlist] = useState<RowState>(LOADING);
  const [tickets, setTickets] = useState<RowState>(LOADING);
  const [ticketItems, setTicketItems] = useState<BookingEntitlement[]>([]);
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const [stamps, setStamps] = useState<RowState>(LOADING);
  const [miles, setMiles] = useState<RowState>(LOADING);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences | 'soon' | null>(null);
  const [prefBusy, setPrefBusy] = useState(false);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    liffRuntime.getProfile().then((p) => setName(p.displayName || null)).catch((e) => logFailure('mypage-profile', e));
  }, []);

  useEffect(() => {
    setFailed(false);
    api.me().then((r) => {
      setHistory({ upcoming: r.upcoming });
      const next = r.upcoming[0];
      if (next) void loadPaymentViews([next]).then((views) => setNextPayment(views[next.id] ?? null));
    }).catch((e) => {
      logFailure('mypage-history', e);
      setFailed(true);
    });
  }, [reloadKey]);

  // キャンセル待ち：待っている・空きの知らせが来ている物だけ数える。
  useEffect(() => {
    api.bookingWaitlists().then((r) => {
      const count = r.waitlist.filter((w) => w.status === 'waiting' || w.status === 'invited').length;
      setWaitlist(count > 0 ? { kind: 'value', text: `${count} 件` } : { kind: 'hidden' });
    }).catch((e) => {
      logFailure('mypage-waitlist', e);
      setWaitlist({ kind: 'hidden' });
    });
  }, [reloadKey]);

  // 回数券・月謝（組3）。口が無い間は準備中。
  useEffect(() => {
    api.entitlements().then((items) => {
      setTicketItems(items);
      const text = entitlementSummary(items);
      setTickets(text ? { kind: 'value', text } : { kind: 'hidden' });
    }).catch((e) => {
      if (isNotReadyYet(e)) { setTickets({ kind: 'soon' }); return; }
      logFailure('mypage-entitlements', e);
      setTickets({ kind: 'hidden' });
    });
  }, [reloadKey]);

  // マイル。制度の無い店は出さない。
  useEffect(() => {
    affiliateSelfApi.rewards().then((r) => {
      setMiles({ kind: 'value', text: r.availableMiles.toLocaleString('ja-JP') });
    }).catch((e) => {
      logFailure('mypage-miles', e);
      setMiles({ kind: 'hidden' });
    });
  }, [reloadKey]);

  // 店（スタンプ・お知らせの受け取りは店ごと）。
  useEffect(() => {
    api.liffConfig().then((r) => setAccountId(r.data?.accountId ?? '')).catch((e) => {
      logFailure('mypage-config', e);
      setAccountId('');
    });
  }, []);

  useEffect(() => {
    if (accountId === null) return;
    if (!accountId) { setStamps({ kind: 'hidden' }); setPrefs('soon'); return; }
    visitStampsApi.cards(accountId).then((r) => {
      const entry = r.data.find((c) => c.card.active) ?? r.data[0];
      if (!entry) { setStamps({ kind: 'hidden' }); return; }
      const balance = entry.wallet.balance;
      const next = [...entry.card.settings.rewards].map((x) => x.stamps).sort((a, b) => a - b).find((n) => n > balance);
      setStamps({ kind: 'value', text: next ? `あと ${next - balance} 個` : `${balance} 個` });
    }).catch((e) => {
      logFailure('mypage-stamps', e);
      setStamps({ kind: 'hidden' });
    });
    api.notificationPreferences(accountId).then((r) => {
      // 送る側が目的ごとに止められるまでは「宣伝だけ止める」を出さない（組1 の 16）。
      setPrefs(r.purposeSpecificEnforcement === true ? r : 'soon');
    }).catch((e) => {
      if (!isNotReadyYet(e)) logFailure('mypage-notification-preferences', e);
      setPrefs('soon');
    });
  }, [accountId, reloadKey]);

  async function togglePref(item: NotificationPreferenceItem) {
    if (prefBusy || !accountId || prefs === null || prefs === 'soon') return;
    const nextEnabled = !(item.enabled ?? false);
    setPrefBusy(true);
    setPrefError(null);
    // 押した手応えを先に出し、失敗したら戻す。
    const before = prefs;
    setPrefs({ ...prefs, items: prefs.items.map((p) => (p.purpose === item.purpose ? { ...p, enabled: nextEnabled } : p)) });
    try {
      const saved = await api.updateNotificationPreference(accountId, item.purpose, nextEnabled, item.version);
      setPrefs({ ...before, ...saved, purposeSpecificEnforcement: saved.purposeSpecificEnforcement ?? before.purposeSpecificEnforcement });
    } catch (e) {
      logFailure('mypage-notification-update', e);
      setPrefs(before);
      const status = (e as { status?: number }).status;
      setPrefError(status === 409
        ? 'ほかの画面で変わっていました。読み直したので、もう一度お試しください。'
        : '変えられませんでした。電波のよいところで、もう一度お試しください。');
      if (status === 409) setReloadKey((k) => k + 1);
    } finally {
      setPrefBusy(false);
    }
  }

  const next = history?.upcoming[0] ?? null;

  return (
    <LiffLookScope className="min-h-screen bg-canvas">
      <LiffHeader title="マイページ" />
      <div data-design-node="L5g75" className="mx-auto w-full max-w-md space-y-3 px-4 pt-3 pb-10">
        <h1 className="truncate text-xl font-bold text-ink" title={name ?? undefined}>{name ? `${name} さん` : 'マイページ'}</h1>
        {failed ? (
          <LoadErrorView note="予約はなくなっていません。" onRetry={() => setReloadKey((k) => k + 1)} />
        ) : !history ? (
          <LoadingView />
        ) : (
          <>
            {next ? (
              <NextBookingCard booking={next} payment={nextPayment} onChange={() => go('/booking/history')} onDetail={() => go('/booking/history')} />
            ) : (
              <Card className="flex items-center justify-between gap-3 p-3.5">
                <p className="text-sm text-ink-secondary">次の予約はありません</p>
                <Button variant="compact-secondary" className="w-auto shrink-0" onClick={() => go('/booking')}>予約する</Button>
              </Card>
            )}

            <Card className="py-0.5">
              <ul>
                <MenuRow icon="hourglass" label="キャンセル待ち" state={waitlist}
                  onPress={() => setNotice('キャンセル待ちの一覧は現在準備中です。空きが出たら LINE でお知らせします。')} />
                <MenuRow icon="ticket" label="回数券" state={tickets} expanded={tickets.kind === 'value' ? ticketsOpen : undefined}
                  onPress={() => (tickets.kind === 'value' ? setTicketsOpen((v) => !v) : setNotice(`回数券は${COMING_SOON}。`))} />
                {tickets.kind === 'value' && ticketsOpen && (
                  <li>
                    <ul className="mx-3.5 mb-2 space-y-1.5 rounded-(--liff-radius) bg-liff-off-bg p-3">
                      {ticketItems.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="truncate font-semibold text-ink" title={e.name}>{e.name}</span>
                          <span className="shrink-0 whitespace-nowrap text-liff-sub">{entitlementDetail(e)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
                <MenuRow icon="stamp" label="スタンプ" state={stamps} onPress={() => go('/visit-stamps')} />
                <MenuRow icon="gem" label="マイル" state={miles} onPress={() => go('/affiliate')} />
                <MenuRow icon="tag" label="クーポン" state={{ kind: 'soon' }} onPress={() => setNotice(`クーポンの一覧は${COMING_SOON}。`)} />
              </ul>
            </Card>
            {notice && <p role="status" className="text-[13px] leading-5 text-ink-secondary">{notice}</p>}

            <Card className="space-y-2.5 p-3.5">
              <h2 className="text-sm font-bold text-ink">お知らせの受け取り</h2>
              {prefs === null ? (
                <p className="text-[13px] text-liff-sub">読み込んでいます…</p>
              ) : prefs === 'soon' ? (
                <p className="text-[13px] leading-5 text-liff-sub">{`お知らせごとの受け取りの設定は${COMING_SOON}。`}</p>
              ) : (
                <ul className="space-y-2">
                  {prefs.items.map((item) => (
                    <PrefRow key={item.purpose} item={item} busy={prefBusy} onToggle={() => void togglePref(item)} />
                  ))}
                </ul>
              )}
              {prefError && <p role="alert" className="text-[13px] leading-5 text-danger">{prefError}</p>}
            </Card>
          </>
        )}
      </div>
    </LiffLookScope>
  );
}

function paymentInk(tone: PaymentView['tone']): string {
  return tone === 'confirmed' ? 'text-liff-ok-ink' : tone === 'pending' ? 'text-liff-wait-ink' : tone === 'info' ? 'text-info-link' : 'text-liff-sub';
}

/** 次の予約（薄い緑の箱）。日付の四角・時刻・メニュー・担当・支払いの状態・2 つのボタン。 */
function NextBookingCard({ booking, payment, onChange, onDetail }: {
  booking: BookingHistoryItem;
  payment: PaymentView | null;
  onChange: () => void;
  onDetail: () => void;
}) {
  const title = booking.staff_name ? `${booking.menu_name}・${booking.staff_name}` : booking.menu_name;
  return (
    <section aria-label="次の予約" className="space-y-3 rounded-(--liff-radius-lg) border border-liff-ok-bg bg-liff-soft p-3.5">
      <div className="flex items-center gap-3">
        <div className="flex h-[52px] w-[52px] shrink-0 flex-col items-center justify-center rounded-(--liff-radius) bg-canvas">
          <span className="liff-num text-[15px] leading-[18px] font-bold whitespace-nowrap text-ink">{utcToJstMd(booking.starts_at)}</span>
          <span className="text-[11px] leading-[14px] text-liff-sub">{utcToJstWeekday(booking.starts_at)}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="liff-num text-xs text-liff-sub">{`次の予約 ${utcToJstHm(booking.starts_at)}`}</p>
          <p className="truncate text-[15px] font-bold text-ink" title={title}>{title}</p>
          {payment ? (
            <p className={`liff-num text-xs font-bold ${paymentInk(payment.tone)}`}>{paymentText(payment)}</p>
          ) : booking.status === 'requested' ? (
            <p className="text-xs font-bold text-liff-wait-ink">お店の確認待ち</p>
          ) : null}
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onChange}>日時を変える</Button>
        <Button variant="secondary" className="flex-1" onClick={onDetail}>予約の詳細</Button>
      </div>
    </section>
  );
}

function MenuRow({ icon, label, state, onPress, expanded }: {
  icon: IconName;
  label: string;
  state: RowState;
  onPress: () => void;
  expanded?: boolean;
}) {
  if (state.kind === 'hidden') return null;
  const value = state.kind === 'value' ? state.text : state.kind === 'soon' ? '準備中' : '…';
  return (
    <li>
      <Button variant="menuRow" onClick={onPress} disabled={state.kind === 'loading'} aria-expanded={expanded}>
        <Icon name={icon} className="h-5 w-5 shrink-0 text-liff-primary" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={`liff-num shrink-0 whitespace-nowrap text-[13px] ${state.kind === 'soon' ? 'text-liff-idle' : 'text-liff-sub'}`}>{value}</span>
        <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-liff-idle" />
      </Button>
    </li>
  );
}

const PREF_HINT: Record<string, string> = {
  booking_reminders: '前日・当日の連絡は止められません',
  marketing: '新しいメニューやクーポンのお知らせ',
};

/**
 * お知らせの受け取りの 1 行。予約のお知らせは止められない（受け取るの札）。
 * 宣伝・キャンペーンは入り／切り。
 */
function PrefRow({ item, busy, onToggle }: { item: NotificationPreferenceItem; busy: boolean; onToggle: () => void }) {
  const label = item.purpose === 'booking_reminders' ? '予約のお知らせ' : item.purpose === 'marketing' ? 'キャンペーン・宣伝' : item.label;
  const on = item.enabled === true;
  return (
    <li className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{label}</p>
        <p className="truncate text-[11px] text-liff-sub">{PREF_HINT[item.purpose] ?? ''}</p>
      </div>
      {item.purpose === 'booking_reminders' ? (
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap ${item.enabled === false ? 'bg-liff-chip text-liff-sub' : 'bg-liff-ok-bg text-liff-ok-ink'}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${item.enabled === false ? 'bg-liff-idle' : 'bg-liff-primary'}`} />
          {item.enabled === false ? '止めています' : '受け取る'}
        </span>
      ) : (
        <Button variant="switch" role="switch" aria-checked={on} aria-label={`${label}を受け取る`} disabled={busy} onClick={onToggle} />
      )}
    </li>
  );
}
