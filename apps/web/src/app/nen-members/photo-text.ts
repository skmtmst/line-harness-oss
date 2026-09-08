'use client'

/**
 * 写真審査3画面で使う小さな表示補助。`components/shared` ではなく
 * この機能の中だけで共有する（#500 軽: `text()` の3ファイル分散の解消）。
 * 見た目の出し方は変えない。未取得は `—` で返さない（呼び側の文言を優先する）。
 */
export const text = (value: unknown): string => String(value ?? '')

/*
 * 呼び方の統一（#500 軽）は列車側で共有の `photoPetDisplayName` へ
 * 一本化されたため、ここには置かない。機能内の表示補助は `text` と
 * `reviewVersionOf` のみ。
 */

/**
 * 楽観ロックの版を整数で取り出す（#500 軽）。
 * 文字や小数など版にならない値が混ざると `Number()` は `NaN` になり、
 * JSONでは `null` 化けして400で返ってくる。版が読めないときは初版 `1`
 * として送り、サーバ側の版競合（409）の正規フローに載せる。
 */
export function reviewVersionOf(photo: Record<string, unknown> | null | undefined): number {
  const raw = photo?.review_version
  const version = typeof raw === 'number' ? raw : Number(raw ?? 1)
  return Number.isInteger(version) && version >= 0 ? version : 1
}
