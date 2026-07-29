import { useState } from 'react';
import type {
  BookingFormField,
  BookingOptionItem,
  LocationItem,
  MenuItem,
  StaffItem,
} from '../lib/api.js';
import { formatJp } from '../lib/datetime.js';

export interface CustomerDetailsValue {
  name: string;
  kana: string;
  phone: string;
  birthdate: string;
  note: string;
  formValues: Record<string, string>;
}

export default function CustomerDetails({
  location,
  menu,
  staff,
  slot,
  options,
  initial,
  fields,
  onNext,
  onBack,
}: {
  location: LocationItem;
  menu: MenuItem;
  staff: StaffItem;
  slot: { date: string; start: string };
  options: BookingOptionItem[];
  initial: CustomerDetailsValue;
  fields: BookingFormField[];
  onNext: (value: CustomerDetailsValue) => void;
  onBack: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const totalDuration = staff.duration_minutes + options.reduce(
    (sum, option) => sum + option.additional_duration_minutes,
    0,
  );
  const totalPrice = staff.price + options.reduce(
    (sum, option) => sum + option.additional_price,
    0,
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = { ...value.formValues };
    normalized.customer_name = value.name;
    normalized.customer_kana = value.kana;
    normalized.customer_phone = value.phone;
    normalized.customer_birthdate = value.birthdate;
    for (const field of fields) {
      if (field.is_required === 1 && !String(normalized[field.field_key] ?? '').trim()) {
        setError(`${field.label}を入力してください。`);
        return;
      }
    }
    const phone = String(normalized.customer_phone ?? '').replace(/[^\d+]/g, '');
    if (phone && !/^\+?\d{10,15}$/.test(phone)) {
      setError('電話番号を数字10〜15桁で入力してください。');
      return;
    }
    normalized.customer_phone = phone;
    onNext({
      ...value,
      name: String(normalized.customer_name ?? '').trim(),
      kana: String(normalized.customer_kana ?? '').trim(),
      phone,
      birthdate: String(normalized.customer_birthdate ?? '').trim(),
      formValues: normalized,
    });
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
        {options.length > 0 && (
          <div className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-slate-700">
            <span className="font-bold">追加オプション</span>
            {options.map((option) => <div key={option.id} className="mt-1">{option.name}</div>)}
          </div>
        )}
        <div className="mt-2 text-xs text-gray-500">担当 {staff.display_name}・合計所要 {totalDuration}分</div>
        <div className="mt-2 text-lg font-bold sb-line-green-text">¥{totalPrice.toLocaleString()}</div>
      </div>

      {fields.filter((field) => field.is_active === 1).map((field) => {
        const fieldValue = systemValue(value, field.field_key);
        const setFieldValue = (next: string) => {
          const patch = {
            formValues: { ...value.formValues, [field.field_key]: next },
          };
          if (field.field_key === 'customer_name') setValue({ ...value, ...patch, name: next });
          else if (field.field_key === 'customer_kana') setValue({ ...value, ...patch, kana: next });
          else if (field.field_key === 'customer_phone') setValue({ ...value, ...patch, phone: next });
          else if (field.field_key === 'customer_birthdate') setValue({ ...value, ...patch, birthdate: next });
          else setValue({ ...value, ...patch });
        };
        return (
          <Field key={field.id} label={field.label} required={field.is_required === 1}>
            {field.field_type === 'textarea' ? (
              <textarea
                value={fieldValue}
                onChange={(e) => setFieldValue(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder={field.placeholder ?? undefined}
                className="sb-input"
              />
            ) : (
              <input
                type={field.field_type}
                inputMode={field.field_type === 'tel' ? 'tel' : undefined}
                value={fieldValue}
                onChange={(e) => setFieldValue(e.target.value)}
                maxLength={field.field_type === 'date' ? undefined : 200}
                placeholder={field.placeholder ?? undefined}
                className="sb-input"
              />
            )}
          </Field>
        );
      })}
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

function systemValue(value: CustomerDetailsValue, key: string): string {
  if (key === 'customer_name') return value.name;
  if (key === 'customer_kana') return value.kana;
  if (key === 'customer_phone') return value.phone;
  if (key === 'customer_birthdate') return value.birthdate;
  return value.formValues[key] ?? '';
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
