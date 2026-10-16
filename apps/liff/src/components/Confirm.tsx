import { useRequestGeneration } from '../lib/use-request-generation.js';
import BookingIntake from './BookingIntake.js';
import { bookingPriceText } from '../lib/booking-price.js';
import { useEffect, useState } from 'react';
import { api, type BookingCancellationPreview, type CreateBookingResponse, type MenuItem, type StaffItem } from '../lib/api.js';
import CancellationPolicy, { yen } from './CancellationPolicy.js';
import { addMinutesHm, formatJpLong, slotStartsAtIso } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import { useWideViewport } from '../lib/use-wide-viewport.js';
import Icon from './ui/Icon.js';
import Button from './ui/Button.js';
import BottomBar from './ui/BottomBar.js';
import PrivacyNote from './ui/PrivacyNote.js';
import type { SlotPick } from './DateTimePicker.js';

/**
 * 1-d 内容の確認 (★V8・gLReL)。送った中身のカード＋ご要望＋案内の帯。
 * 進む操作 (この内容で予約をリクエスト) は下の操作の帯にだけ置く。
 * 送信の失敗は入力を消さず、その場で理由を出す (動きはそのまま)。
 */
export default function Confirm({
  menu,
  staff,
  slot,
  autoConfirm,
  cancelDeadlineMinutesBefore = null,
  onBack,
  onSubmitted,
}: {
  menu: MenuItem;
  staff: StaffItem;
  slot: SlotPick;
  /** 予約のルールが承認なし確定のとき真。未承認の案内を出さない。 */
  autoConfirm: boolean;
  cancelDeadlineMinutesBefore?: number | null;
  /** 「← 日時を選び直す」。日時の段へ戻る。 */
  onBack: () => void;
  /** 予約ができたら予約ID・状態・支払い(お支払いありのときだけ付く)を渡す。前払いのみの案内も付く。 */
  onSubmitted: (result: {
    bookingId: string;
    status: string;
    payment: CreateBookingResponse['payment'];
    prepayNotice: string | null;
  }) => void;
}) {
  // 414 幅の板（`uZqMA`）は板 ID だけを替える。中身は同じ。
  const wide = useWideViewport();
  const deadline = menu.cancel_deadline_hours_before == null ? cancelDeadlineMinutesBefore : menu.cancel_deadline_hours_before * 60;
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => crypto.randomUUID());
  const [setupKey] = useState(() => crypto.randomUUID());
  /* キャンセル料の決まり（B1）。口が無い・オフの店は null で、今までどおり。 */
  const [policy, setPolicy] = useState<BookingCancellationPreview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const startsAt = slotStartsAtIso(slot);
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => api.cancellationPreview({ menuId: menu.id, staffId: staff.id, startsAt })).catch(() => null).then((data) => {
      if (alive) { setPolicy(data && data.enabled ? data : null); setAccepted(false); }
    });
    return () => { alive = false; };
  }, [menu.id, staff.id, startsAt]);

  const request = useRequestGeneration(JSON.stringify([menu.id, staff.id, slot.date, slot.start]));
  function back() {
    request.invalidate();
    setSubmitting(false);
    onBack();
  }

  async function handleSubmit() {
    if (submitting) return;
    const generation = request.begin();
    setSubmitting(true);
    setError(null);
    try {
      /* キャンセル料がオンの店：カードを登録（試験モード）してから、確かめた決まりの版と一緒に送る。登録がまだなら登録の画面へ。 */
      let consent: { policyAccepted: true; policyVersion: number; setupIntentId: string } | null = null;
      if (policy) {
        const setup = await api.cancellationSetup(menu.id, setupKey);
        if (!request.isCurrent(generation)) return;
        if (setup.status !== 'ready') {
          window.location.assign(setup.url);
          return;
        }
        consent = { policyAccepted: true, policyVersion: policy.version, setupIntentId: setup.setupIntentId };
      }
      const created = await api.createRequest(
        {
          menu_id: menu.id,
          staff_id: staff.id,
          // 空き枠が返した開始の瞬間を送る（店が日本時間以外でもずれない）。
          starts_at: startsAt,
          customer_note: note || undefined,
          ...(consent ?? {}),
        },
        idemKey,
      );
      if (!request.isCurrent(generation)) return;
      if (created.payment_required && !created.payment?.id) {
        setError('予約できませんでした。もう一度お試しください');
        return;
      }
      onSubmitted({
        bookingId: created.booking_id,
        status: created.status,
        payment: created.payment ?? null,
        prepayNotice: created.prepayNotice ?? null,
      });
    } catch (e) {
      if (!request.isCurrent(generation)) return;
      logFailure('create-request', e);
      const err = e as { status?: number; body?: { error?: string } };
      if (err.status === 409 && err.body?.error === 'policy_changed') {
        setAccepted(false);
        setPolicy(await api.cancellationPreview({ menuId: menu.id, staffId: staff.id, startsAt }).then((data) => (data && data.enabled ? data : null)));
        setError('キャンセル料の決まりが変わりました。もう一度確かめてから予約してください。');
      } else if (err.status === 409 && err.body?.error === 'card_not_registered') {
        setError('カードの登録が済んでいません。もう一度押して、カードを登録してください。');
      } else if (err.status === 409 && err.body?.error === 'payment_not_connected') {
        setError('いまはこのお店でカードの登録ができません。お店にご連絡ください。');
      } else if (err.status === 409 && err.body?.error === 'slot_conflict') {

        setError('この時間枠は他の方の予約と重なりました。日時を選び直してください。');
      } else {
        setError('予約できませんでした。もう一度お試しください');
      }
    } finally {
      if (request.isCurrent(generation)) setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3.5" data-design-node={wide ? 'uZqMA' : 'gLReL'}>
      <h2 className="text-xl font-bold text-ink">内容を確かめてください</h2>
      <dl data-liff-card className="divide-y divide-liff-divider rounded-(--liff-radius-lg) bg-canvas px-3.5 py-1 outline outline-1 -outline-offset-1 outline-liff-line">
        <Row label="メニュー" value={menu.name} />
        <Row
          label="日時"
          value={`${formatJpLong(slot.date)}${slot.start}〜${addMinutesHm(slot.start, staff.duration_minutes)}`}
        />
        <Row label="担当" value={staff.display_name} />
        <Row
          label="料金"
          value={policy ? bookingPriceText(staff.price, staff.price_mode ?? menu.price_mode) : `${bookingPriceText(staff.price, staff.price_mode ?? menu.price_mode)}（目安・お店で払う）`}
        />
        {policy?.deposit ? (
          <>
            <Row label="今お支払い（デポジット）" value={yen(policy.deposit.amount)} wideLabel />
            <Row label="お店で" value={yen(Math.max(0, policy.price - policy.deposit.amount))} />
          </>
        ) : null}
      </dl>
      <BookingIntake question={menu.intake_question} value={note} onChange={setNote} />
      {error && (
        <p role="alert" className="text-[13px] leading-6 text-danger">
          {error}
        </p>
      )}
      {policy ? <CancellationPolicy preview={policy} accepted={accepted} onAcceptedChange={setAccepted} /> : null}
      {policy ? null : (
      <div className="flex gap-2 rounded-(--liff-radius) bg-liff-note p-3 text-xs leading-[18px] text-ink">
        <Icon name="info" tone="booking-info" className="h-4 w-4 shrink-0" />
        <p>
          {autoConfirm
            ? '送るとその場で確定します。確定のお知らせをLINEで送ります。'
            : 'まだ確定ではありません。お店が確かめたら、LINEでお知らせします。'}
          {deadline != null ? `キャンセルは開始の${deadline % 60 === 0 ? `${deadline / 60}時間` : `${deadline}分`}前まで。` : 'キャンセル期限は予約の履歴で確認してください。'}
        </p>
      </div>
      )}
      <PrivacyNote />
      <div className="pb-40" aria-hidden="true" />
      <BottomBar>
        <Button variant="primary" onClick={handleSubmit} disabled={submitting || (policy !== null && !accepted)}>
          {submitting ? '送信中...'
            : policy?.deposit ? `${yen(policy.deposit.amount)} を払って予約する`
              : policy ? 'カードを登録して予約する'
                : autoConfirm ? 'この内容で予約を確定する' : 'この内容で予約をリクエストする'}
        </Button>
        <Button variant="text"
          type="button"
          onClick={back}
        >
          ← 日時を選び直す
        </Button>
      </BottomBar>
    </div>
  );
}

/** 確認の1行。板 (gLReL) は 1行 40 (線を含む)・鍵と値は上ぞろえ。 */
function Row({ label, value, wideLabel = false }: { label: string; value: string; wideLabel?: boolean }) {
  return (
    <div className="flex h-10 items-start gap-2 py-2.5">
      <dt className={`${wideLabel ? 'whitespace-nowrap' : 'w-18'} shrink-0 text-xs text-liff-sub`}>{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}
