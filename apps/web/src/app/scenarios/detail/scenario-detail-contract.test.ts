import nodeFs from 'node:fs'
import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
const fs = { ...nodeFs, readFileSync: readUiSource }
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * シナリオ編集の動きは画面を描いて押して守る。
 * - まとめてテスト送信・テスト送信先のアカウント・置き場の候補：v8/scenario-detail/detail-actions.test.tsx、
 *   components/scenarios/test-send-dialog-pick.test.tsx
 * - 一覧のフォルダの列・フォルダへ移す・今月作った：v8/scenarios/list-filters-and-folders.test.tsx
 * ここには戻してはいけない書き方の見張りだけを残す。
 */
const PAGE = fs.readFileSync(
  path.join(__dirname, 'scenario-detail-client.tsx'),
  'utf8',
)
/* 一覧の入口は src/v8/scenarios/list.tsx（2026-10-06〜。古い list-v8.tsx はもう描かれない）。 */
const LIST = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'v8', 'scenarios', 'list.tsx'), 'utf8')

describe("管理画面 シナリオ編集の契約", () => {
  it('一括テスト送信を準備中に戻さない', () => {
    expect(PAGE).not.toContain('一括テスト送信は準備中です')
  })

  it('フォルダ候補を無指定（全権限範囲）で取らない', () => {
    /*
     * SCENARIO-20: 無指定の folders.list は全権限範囲を返すため、
     * 別アカウントの同名フォルダを選んで保存できてしまう。
     */
    expect(PAGE).not.toContain("api.folders.list('scenario')")
  })

  it('一覧のフォルダ追加を準備中の押せない口に戻さない', () => {
    expect(LIST).not.toContain('title="準備中です"\n          className="border-hairline text-ink-faint rounded-control border px-4')
  })

  it('「今月作成」を読み込んだページの中だけで絞らない', () => {
    expect(LIST).not.toContain('createdThisMonthOnly ? isCreatedThisMonth(sc.createdAt) : true')
  })
})
