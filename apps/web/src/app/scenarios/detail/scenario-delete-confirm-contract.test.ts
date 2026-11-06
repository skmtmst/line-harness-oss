import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

/*
 * シナリオ全体を削除する確認の動き（共通の窓で開く・影響を読む・成功だけ閉じる・失敗は窓に残す・二度押し）は
 * v8/scenario-detail/detail-actions.test.tsx が画面を描いて押して守る。ここには戻してはいけない書き方の見張りだけを残す。
 */
const PAGE = readFileSync(new URL('./scenario-detail-client.tsx', import.meta.url), 'utf8')

describe("管理画面 dqFft シナリオ全体を削除する確認", () => {
  it('ブラウザ標準confirmと、通信のせいにする古い失敗文へ戻さない', () => {
    expect(PAGE).not.toContain('if (!confirm(message)) return')
    expect(PAGE).not.toContain("setError('削除に失敗しました。通信を確かめて、もう一度お試しください。')")
  })
})
