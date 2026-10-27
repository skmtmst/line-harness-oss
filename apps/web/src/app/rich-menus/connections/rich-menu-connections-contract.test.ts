import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 切替のつながりの動き（板・空・所属違い・遅れた応答・読込/失敗/読み直し）は
 * connections-v8-react.test.tsx、一覧からの入口は v8/rich-menus/list-delete-import-react.test.tsx が描いて見る。
 * ここには、固定の数を画面に書かない禁止の見張りだけを残す。
 */
const PAGE = fs.readFileSync(path.join(__dirname, '../../../v8/rich-menus/connections.tsx'), 'utf8')

describe('V8 リッチメニューの切替つながり', () => {
  it('切替数を固定値で作らない', () => {
    expect(PAGE).not.toContain('切替ボタン" value="5件')
  })
})
