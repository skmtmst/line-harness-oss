import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * IDEA-03「検索から配信等へ進むときは対象条件を引き継ぐ」の禁止の見張り。
 * 引き継ぎ・一覧状態の保存と復元は friends-list-behavior.test.tsx、受け取り側は
 * broadcast-condition-handoff.test.tsx、詳細の履歴は detail/friend-detail-tabs-behavior.test.tsx が描いて確かめる。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST_PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('一覧 → 配信作成の条件引き継ぎ', () => {
  it('表示中ページの友だちIDを対象にしない（friend_id_in は使わない）', () => {
    expect(LIST_PAGE).not.toContain('friend_id_in')
  })

  it('配信リンクはアカウントの役割メモではなく本人の役割で判定する', () => {
    expect(LIST_PAGE).not.toContain('canRunBulk(selectedAccount')
  })
})
