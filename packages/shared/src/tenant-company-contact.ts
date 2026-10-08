/** 統括の正式な会社情報。表示用の統括名とは別に保存する。 */
export interface TenantCompanyContact {
  legalCompanyName: string | null;
  postalCode: string | null;
  address: string | null;
  building: string | null;
  phone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  invoiceAddressee: string | null;
}

export interface TenantCompanyContactInfo extends TenantCompanyContact {
  /** 会社の表示設定と同じ既存の版を使う。保存は期待する版との比較で行う。 */
  revision: number;
}

export interface SaveTenantCompanyContact extends TenantCompanyContact {
  expectedRevision: number;
}

export const COMPANY_CONTACT_FIELDS = [
  { key: 'legalCompanyName', label: '会社名（正式）', required: true, max: 200 },
  { key: 'postalCode', label: '郵便番号', required: true, max: 8 },
  { key: 'address', label: '住所', required: true, max: 500 },
  { key: 'building', label: '建物名・部屋番号', required: false, max: 200 },
  { key: 'phone', label: '電話番号', required: true, max: 32 },
  { key: 'contactName', label: '担当者名', required: true, max: 100 },
  { key: 'contactEmail', label: '担当者のメール', required: true, max: 254 },
  { key: 'invoiceAddressee', label: '請求書の宛名', required: false, max: 200 },
] as const;

/** サーバと画面で同じ必須・形式の検査を使う。空の任意欄はNULLにする。 */
export function parseTenantCompanyContact(value: unknown):
  { data: TenantCompanyContact; error?: never } | { error: string; data?: never } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '会社と連絡先を確認してください。' };
  const source = value as Record<string, unknown>;
  const data = {} as TenantCompanyContact;
  for (const field of COMPANY_CONTACT_FIELDS) {
    const raw = source[field.key];
    if (raw != null && typeof raw !== 'string') return { error: `${field.label}を文字で入力してください。` };
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (field.required && !text) return { error: `${field.label}を入力してください。` };
    if (text.length > field.max) return { error: `${field.label}は${field.max}文字以内で入力してください。` };
    if (/[\u0000-\u001f\u007f]/.test(text)) return { error: `${field.label}に改行や制御文字は使えません。` };
    data[field.key] = text || null;
  }
  if (!/^\d{3}-?\d{4}$/.test(data.postalCode!)) return { error: '郵便番号は7桁で入力してください。' };
  data.postalCode = data.postalCode!.replace('-', '');
  const digits = data.phone!.replace(/\D/g, '');
  if (!/^\+?[0-9][0-9 ()-]*$/.test(data.phone!) || digits.length < 10 || digits.length > 15
    || (!data.phone!.startsWith('+') && !/^0\d{9,10}$/.test(digits))) {
    return { error: '電話番号を確認してください。例：03-1234-5678' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail!)) return { error: '担当者のメールをメールアドレスの形で入力してください。' };
  return { data };
}
