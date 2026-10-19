/** 入力・既存データの読取り用。許された区切りだけ外し、誤った文字は検査のため残す。 */
export function normalizePhone(phone: string): string {
  return phone
    .replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[\s()（）\-－‐‑‒–—―−ー]/g, '');
}

/** 任意の電話欄。空欄は許し、値があれば日本の0始まり10〜11桁を確認する。 */
export function phoneProblem(phone: string): string {
  if (!phone.trim()) return '';
  if (phone.length > 50 || !/^0\d{9,10}$/.test(normalizePhone(phone))) {
    return '電話番号は0から始まる10〜11桁の数字で入れてください。';
  }
  return '';
}

/** 区切りのない保存値も伏せる。不正な旧データの本文はそのまま表示しない。 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = normalizePhone(phone);
  if (!/^0\d{9,10}$/.test(digits)) return '****';
  return `${digits.slice(0, digits.length === 10 ? 2 : 3)}-****-${digits.slice(-4)}`;
}
