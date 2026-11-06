/**
 * R523: 保存の応答を失ったとき、同じチャネルIDで作られた行が残っていないか
 * 照合するための小さな関数。応答が無い失敗を「未保存」と断定せず、
 * 登録済み1件だけを特定して詳細へ復帰するために使う。
 * 複数・0件のときは特定できないので null（行き止まりにしない）。
 */
export function matchRegisteredAccountId(
  accounts: Array<{ id: string; channelId: string }>,
  channelId: string,
): string | null {
  const want = channelId.trim()
  if (!want) return null
  const found = accounts.filter((account) => account.channelId === want)
  return found.length === 1 ? found[0].id : null
}

/** サーバの重複エラーの目印（英語のまま返ることがある）。 */
export function isDuplicateChannelError(message: string): boolean {
  return /already registered|UNIQUE constraint/i.test(message)
}
