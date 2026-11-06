import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const TABLE = readFileSync(join(__dirname, '..', '..', 'components', 'friends', 'friend-list-table.tsx'), 'utf8')

/*
 * 友だち一覧の表の高さの禁止の見張り。
 * ［未対応］［注目のみ］の札は friends-list-behavior.test.tsx、統合ユーザーの操作の行は
 * users/users-toolbar-behavior.test.tsx が押して確かめる。表の高さ・余白は v8-screen-guard が見る。
 */
describe('友だち一覧の表の高さ', () => {
  it('一覧を行数に合わせ、表の下に固定の空白を残さない', () => {
    expect(TABLE).not.toContain('min-h-155')
    expect(TABLE).not.toContain('min-h-77.5')
    expect(TABLE).not.toContain('min-h-0 flex-1')
  })
})
