import { readUiSource, readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(new URL('./page.tsx', import.meta.url), 'utf8')
const NEW_PAGE = readFileSync(new URL('./new/page.tsx', import.meta.url), 'utf8')

/**
 * 管理画面 成果地点（`/conversions?tab=points`）の禁止の見張り。
 * 「未接続」「準備中」の言葉で押せない操作を置かない。
 * 空・読込・失敗の言い分け、口の集計、一覧でない返事、ページ送り、CSV、作成の試算と保存の形は
 * v8/conversions/list.test.tsx・create.test.tsx と app/conversions の描画試験が確かめる。
 */
describe("管理画面 成果地点一覧の契約", () => {
  it('一覧は未接続・準備中の言葉を出さない', () => {
    expect(PAGE).not.toContain('利用先の取得は未接続')
    expect(PAGE).not.toContain('ページの切り替えは準備中です')
    expect(PAGE).not.toContain('書き出しはまだ繋がっていません。')
    expect(PAGE).not.toContain('CSVの書き出し口は未接続です。')
    expect(PAGE).not.toContain('準備中')
  })

  it('作成画面は未接続・準備中の言葉を出さない', () => {
    expect(NEW_PAGE).not.toContain('保存前試算APIの接続後')
    expect(NEW_PAGE).not.toContain('準備中')
    expect(NEW_PAGE).not.toContain('Webhookで受け取った')
    expect(NEW_PAGE).not.toContain('保存契約は未接続')
    expect(NEW_PAGE).not.toContain('利用先APIの接続後')
  })
})
