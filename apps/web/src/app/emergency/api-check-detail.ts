/**
 * 「API・外部連携」の確認結果の文。
 *
 * **数が取れないときに例外を投げない。**
 *
 * 以前は `commerce.last24h.toLocaleString('ja-JP')` と直に書いていた。
 * EC連携の口が期待と違う形（`{items:[],total:0}` など）を返すと
 * `last24h` が `undefined` になり、`toLocaleString` で落ちる。
 * この処理は6項目をまとめて組み立てる途中にあるので、**1つ落ちると
 * 残り5項目も作られず、画面は「確認しています…」のまま止まる**。
 * 1つの数が読めないだけで、健全性チェック全体が動かなくなっていた。
 */
export function apiCheckDetail(last24h: unknown): string {
  if (typeof last24h === 'number' && Number.isFinite(last24h)) {
    return `管理APIとEC連携データを確認しました（24時間以内の受信${last24h.toLocaleString('ja-JP')}件）`
  }
  // 0件と「読めなかった」を混ぜない。読めないときは件数を出さない。
  return '管理APIを確認しました。EC連携の受信件数は読み込めませんでした'
}
