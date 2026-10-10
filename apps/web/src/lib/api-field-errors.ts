/**
 * APIクライアントが安全な文だけを入れた fields を、保存の共通部品へ渡す。
 * 型の判定は構造で行う。別のクライアント・編集ホストが返したエラーも同じ扱いにする。
 * 許可するのは入力検査の400/422と、文字列の欄名・理由だけ。
 */
export function readSaveFieldErrors(error: unknown): Record<string, string> {
  if (!error || typeof error !== 'object' || !('status' in error) || (error.status !== 400 && error.status !== 422) || !('fields' in error)) return {}
  const fields = error.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {}
  return Object.fromEntries(Object.entries(fields).filter(([key, message]) => key.length > 0 && typeof message === 'string' && message.trim().length > 0))
}
