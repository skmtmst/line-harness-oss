import { useState } from 'react';
import {
  createApi,
  type BookingFormField,
  type ConsentSetting,
  type LocationItem,
  type MenuItem,
  type StaffItem,
} from '../lib/api.js';
import { useSalonContext } from '../lib/context.js';
import { jstStartsAtIso, formatJp } from '../lib/datetime.js';
import type { CustomerDetailsValue } from './CustomerDetails.js';

export default function Confirm({
  location,
  menu,
  staff,
  slot,
  customer,
  fields,
  changeBookingId,
  consent,
  onSubmitted,
  onBack,
}: {
  location: LocationItem;
  menu: MenuItem;
  staff: StaffItem;
  slot: { date: string; start: string };
  customer: CustomerDetailsValue;
  fields: BookingFormField[];
  changeBookingId?: string | null;
  consent: ConsentSetting;
  onSubmitted: () => void;
  onBack: () => void;
}) {
  const ctx = useSalonContext();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => crypto.randomUUID());
  const mustAgree = consent.is_active === 1 && consent.is_required === 1;

  async function handleSubmit() {
    if (mustAgree && !agreed) {
      setError(`${consent.title}への同意が必要です。`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const requestBody = {
          location_id: location.id,
          menu_id: menu.id,
          staff_id: staff.id,
          starts_at: jstStartsAtIso(slot.date, slot.start),
          customer_note: customer.note || undefined,
      };
      if (changeBookingId) {
        await createApi(ctx).change(changeBookingId, requestBody);
      } else {
        await createApi(ctx).createRequest(
          {
          ...requestBody,
          customer_name: customer.name,
          customer_kana: customer.kana,
          customer_phone: customer.phone,
          customer_birthdate: customer.birthdate,
          form_values: customer.formValues,
          consent_agreed: agreed,
          consent_version: consent.version,
        },
        idemKey,
      );
      }
      try {
        localStorage.setItem(
          'meauty_booking_customer',
          JSON.stringify({
            name: customer.name,
            kana: customer.kana,
            phone: customer.phone,
            birthdate: customer.birthdate,
            formValues: customer.formValues,
          }),
        );
      } catch {
        // Private browsing/storage denial must not make a successful booking fail.
      }
      onSubmitted();
    } catch (e) {
      const err = e as { status?: number; body?: { error?: string } };
      if (err.status === 409 && err.body?.error === 'slot_conflict') {
        setError('この時間枠は他の方の予約と重なりました。日時を選び直してください。');
      } else if (err.status === 422 && err.body?.error === 'consent_required') {
        setError('同意書が更新されました。一度戻って内容を再確認してください。');
      } else {
        setError(`${changeBookingId ? '変更' : '予約'}リクエストの送信に失敗しました。時間をおいて再度お試しください。`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5 sb-slide-up">
      <button onClick={onBack} className="sb-back-btn">
        <span aria-hidden>←</span>入力内容を変更
      </button>
      <h1 className="text-xl font-bold text-slate-800">予約内容の確認</h1>

      <div className="sb-summary-card">
        <dl className="space-y-3 text-sm">
          <Row label="日時" value={`${formatJp(slot.date)} ${slot.start}〜`} strong />
          <Row label="店舗" value={location.name} />
          <Row label="メニュー" value={menu.name} />
          <Row label="担当" value={staff.display_name} />
          <Row label="所要時間" value={`${staff.duration_minutes}分`} />
          <Row label="料金" value={`¥${staff.price.toLocaleString()}`} strong />
        </dl>
      </div>

      <div className="sb-card">
        <dl className="space-y-4 text-sm">
          {fields.filter((field) => field.is_active === 1).map((field) => (
            <Row
              key={field.id}
              label={field.label}
              value={customer.formValues[field.field_key] ?? systemValue(customer, field.field_key)}
            />
          ))}
          {customer.note && <Row label="ご要望" value={customer.note} />}
        </dl>
      </div>

      {consent.is_active === 1 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-slate-800">{consent.title}</h2>
          <div className="sb-consent-body">{consent.body}</div>
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-6 w-6 shrink-0 accent-green-600"
            />
            <span className="text-sm font-bold leading-6 text-slate-700">
              {consent.title}に同意する
              {mustAgree && <span className="ml-2 rounded bg-orange-600 px-1.5 py-0.5 text-[10px] text-white">必須</span>}
            </span>
          </label>
        </section>
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <button
        onClick={handleSubmit}
        disabled={submitting || (mustAgree && !agreed)}
        className="sb-primary-btn"
      >
        {submitting ? '送信中…' : changeBookingId ? '予約変更をリクエストする' : '予約リクエストを確定する'}
      </button>
      <p className="text-center text-xs text-gray-400">店舗の承認後に{changeBookingId ? '変更' : '予約'}確定となり、LINEでお知らせします。</p>
    </div>
  );
}

function systemValue(customer: CustomerDetailsValue, key: string): string {
  if (key === 'customer_name') return customer.name;
  if (key === 'customer_kana') return customer.kana;
  if (key === 'customer_phone') return customer.phone;
  if (key === 'customer_birthdate') return customer.birthdate;
  return '';
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-b border-dashed border-gray-200 pb-3 last:border-0 last:pb-0">
      <dt className="text-xs font-semibold text-gray-500">{label}</dt>
      <dd className={strong ? 'font-bold sb-line-green-text' : 'font-semibold text-slate-800'}>{value}</dd>
    </div>
  );
}
