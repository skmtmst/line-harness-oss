import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p: string) => readFileSync(join(SRC, p), 'utf8')

const TAGS_MIGRATE = read('app/tags/fields/migrate/page.tsx')
const RESPONSES = read('app/form-submissions/responses/page.tsx')
const REMINDERS_EDIT = read('app/reminders/edit/page.tsx')
const WEBINARS_EDIT = read('app/webinars/edit/page.tsx')
const INFLOW_DETAIL = read('app/inflow-links/detail/page.tsx')

/*
 * #975 U097: 「一覧へ戻ってください」「一覧から選び直してください」と
 * 書くだけで、実際の操作がなかった画面へ、該当の一覧へ戻れる
 * 操作を足す。
 */
describe('一覧へ戻る操作を置く（#975 U097）', () => {
  it('友だち属性の移行は、アカウント未選択と対象なしの両方で一覧へ戻れる', () => {
    expect(TAGS_MIGRATE).toContain('href="/tags?tab=fields"')
    expect(TAGS_MIGRATE).toContain('友だち情報欄の一覧へ戻る')
    expect(TAGS_MIGRATE).toContain('移行元の項目が見つかりません')
  })

  it('回答を見る画面は、対象未指定と対象なしの両方で一覧へ戻れる', () => {
    expect(RESPONSES).toContain('href="/form-submissions"')
    expect(RESPONSES).toContain('回答フォーム一覧へ戻る')
    expect(RESPONSES).toContain('回答フォームが指定されていません')
    expect(RESPONSES).toContain('回答フォームが見つかりません')
  })

  it('リマインダー編集は、IDなしで一覧へ戻れる', () => {
    expect(REMINDERS_EDIT).toContain('href="/reminders"')
    expect(REMINDERS_EDIT).toContain('リマインダ一覧へ戻る')
    // IDがないときは取得しない。
    expect(REMINDERS_EDIT).toContain('if (!id)')
  })

  it('ウェビナー編集は、IDなしと対象なしの両方で一覧へ戻れる', () => {
    expect(WEBINARS_EDIT).toContain('href="/webinars"')
    expect(WEBINARS_EDIT).toContain('ウェビナー一覧へ戻る')
    expect(WEBINARS_EDIT).toContain('ウェビナーが見つかりませんでした')
    expect(WEBINARS_EDIT).toContain('if (!id)')
  })

  it('流入リンク詳細は、表示できないとき一覧へ戻れる', () => {
    expect(INFLOW_DETAIL).toContain('href="/inflow-links"')
    expect(INFLOW_DETAIL).toContain('流入経路の一覧へ戻る')
  })
})
