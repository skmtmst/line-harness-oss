export function readPriority(raw: unknown): { ok: true; value: number } | { ok: false } {
  const n = Number(raw);
  // 上下に余裕を持たせる。間に挿し込めないと、並べ替えのたびに
  // 全件を振り直すことになる。
  if (!Number.isInteger(n) || n < -9999 || n > 9999) return { ok: false };
  return { ok: true, value: n };
}
