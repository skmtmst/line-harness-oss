


export function fingerprintMatches(stored: string | null, expected: string): boolean {
  // 指紋のない旧行は比較できないので、状態の判定に任せる。
  if (stored == null || stored === '') return true;
  if (stored === expected) return true;
  // 通貨なしの旧形式は、cとvが合えば円として通す。通貨違いは別内容。
  try {
    const s = JSON.parse(stored) as { c?: unknown; v?: unknown; cur?: unknown };
    const e = JSON.parse(expected) as { c?: unknown; v?: unknown; cur?: unknown };
    if (typeof s !== 'object' || s === null || typeof e !== 'object' || e === null) return false;
    return s.c === e.c && s.v === e.v && (s.cur ?? 'JPY') === (e.cur ?? 'JPY');
  } catch {
    return false;
  }
}
