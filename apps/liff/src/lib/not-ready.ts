/**
 * まだ本物の口が無い機能か。404・501（口が無い）と 503 の「準備ができていない」を
 * 「現在準備中です」として扱う。それ以外の失敗は読み込みの失敗として扱う。
 */
export function isNotReadyYet(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 404 || status === 501 || status === 503;
}
