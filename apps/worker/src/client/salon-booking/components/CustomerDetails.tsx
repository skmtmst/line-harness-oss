import { useState } from 'react';
import type { LocationItem, MenuItem, StaffItem } from '../lib/api.js';
import { formatJp } from '../lib/datetime.js';

export interface CustomerDetailsValue {
  name: string;
  kana: string;
  phone: string;
  note: string;
}

export default function CustomerDetails({
  location,
  menu,
  staff,
  slot,
  initial,
  onNext,
  onBack,
}: {
  location: LocationItem;
  menu: MenuItem;
  staff: StaffItem;
  slot: { date: string; start: string };
  initial: CustomerDetailsValue;
  onNext: (value: CustomerDetailsValue) => void;
  onBack: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const phone = value.phone.replace(/[^\d+]/g, '');
    if (!value.name.trim() || !value.kana.trim() || !phone) {
      setError('お名前・フリガナ・電話番号をすべて入力してください。');
      return;
    }
    if (!/^\+?\d{10,15}$/.test(phone)) {
      setError('電話番号を数字10〜15桁で入力してください。');
      return;
    }
    onNext({ ...value, name: value.name.trim(), kana: value.kana.trim(), phone });
  }

  return (
    <form onSubmit={submit} className="space-y-5 sb-slide-up">
      <button type="button" onClick={onBack} className="sb-back-btn">
        <span aria-hidden>←</span>日時を選び直す
      </button>
      <div>
        <h1 className="text-xl font-bold text-slate-800">お客様情報を入力</h1>
        <p className="mt-1 text-xs text-gray-500">前回入力した内容は端末に保存されます。</p>
      </div>

      <div className="sb-summary-card">
        <div className="sb-summary-date">{formatJp(slot.date)} {slot.start}〜</div>
        <div className="mt-3 text-sm font-bold text-slate-800">{location.name}</div>
        <div className="mt-2 font-bold sb-line-green-text">{menu.name}</div>
        <div className="mt-1 text-xs text-gray-500">担当 {staff.display_name}・所要 {staff.duration_minutes}分</div>
        <div className="mt-2 text-lg font-bold sb-line-green-text">¥{staff.price.toLocaleString()}</div>
      </div>

      <Field label="お名前" required>
        <input
          value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })}
          autoComplete="name"
          maxLength={100}
          placeholder="例：坂本 真人"
          className="sb-input"
        />
      </Field>
      <Field label="お名前（カナ）" required>
        <input
          value={value.kana}
          onChange={(e) => setValue({ ...value, kana: e.target.value })}
          maxLength={100}
          placeholder="例：サカモト マサト"
          className="sb-input"
        />
      </Field>
      <Field label="電話番号" required>
        <input
          type="tel"
          inputMode="tel"
          value={value.phone}
          onChange={(e) => setValue({ ...value, phone: e.target.value })}
          autoComplete="tel"
          placeholder="例：09012345678"
          className="sb-input"
        />
      </Field>
      <Field label="ご要望・事前相談">
        <textarea
          value={value.note}
          onChange={(e) => setValue({ ...value, note: e.target.value })}
          maxLength={2000}
          rows={4}
          placeholder="気になる点やご要望があれば入力してください"
          className="sb-input"
        />
      </Field>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <button type="submit" className="sb-primary-btn">入力内容を確認する</button>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
        {label}
        {required && <span className="rounded bg-orange-600 px-1.5 py-0.5 text-[10px] text-white">必須</span>}
      </span>
      {children}
    </label>
  );
}
