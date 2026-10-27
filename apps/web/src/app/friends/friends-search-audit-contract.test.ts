import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 友だちの検索条件・保存検索・集計の禁止の見張り。
 * 振る舞いは components/friends/advanced-search-behavior.test.tsx（FRIEND-01/02/04/05/20/29/32, A03-02）、
 * components/friends/saved-search-dialog-state.test.tsx（FRIEND-18/19）、
 * friends-list-behavior.test.tsx（FRIEND-04 の一覧への反映・FRIEND-06/07/08）が描いて確かめる。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const DIALOG = readFileSync(join(HERE, '..', '..', 'components', 'friends', 'advanced-search-dialog.tsx'), 'utf8')

describe('FRIEND-01 対象の選択を1か所の明示的な4値にする', () => {
  it('空文字を「非表示」と「すべて」の両方に使う二重管理はしない', () => {
    expect(DIALOG).not.toContain("setVisibility(''")
  })
})
