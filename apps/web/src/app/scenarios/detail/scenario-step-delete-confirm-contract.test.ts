import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

/*
 * 通の削除の確認・失敗・読み直しの動きは v8/scenario-detail/step-rows.test.tsx が描いて押して守る。
 * ここはブラウザ標準の confirm と生の失敗文へ戻さない禁止の見張りだけを残す。
 */
const PAGE = readFileSync(new URL('./scenario-detail-client.tsx', import.meta.url), 'utf8')

describe("管理画面 dqFft シナリオの通を削除する確認", () => {
  it('ブラウザ標準confirmを使わず共通の取り消せない操作の窓を使う', () => {
    expect(PAGE).not.toContain("confirm('このステップを削除してもよいですか？')")
  })

  it('削除中の二重操作を止め、失敗しても窓を閉じず日本語で再試行を案内する', () => {
    expect(PAGE).not.toContain("setError('ステップの削除に失敗しました')")
  })
})
