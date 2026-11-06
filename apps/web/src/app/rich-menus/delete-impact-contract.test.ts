import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../v8/rich-menus/list.tsx'), 'utf8')

/*
 * リッチメニューの削除確認。
 * 窓を開けてから読む・読めないときは消させない・4つの影響・0件の言い方・
 * 閉じたら捨てる・409の描き直し・遅れた応答と世代は
 * v8/rich-menus/list-delete-import-react.test.tsx が押して見る。
 * ここには禁止の見張りだけを残す。
 */
describe('リッチメニューの削除確認', () => {
  it('押せるように見えて何も起きない口を作らない', () => {
    expect(PAGE).not.toContain('() => undefined')
  })

  it('消せない理由を内部の記号のまま並べない', () => {
    expect(PAGE).not.toContain('impact.blockers.join')
  })
})
