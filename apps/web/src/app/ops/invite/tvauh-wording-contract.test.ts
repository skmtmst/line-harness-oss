import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/** 運営メンバーの招待を受ける画面（板 `tVaUh`）の言葉を絵に合わせる歯止め。 */
describe('tVaUh 招待を受ける画面', () => {
  it('ボタンを絵の言葉にする', () => {
    expect(PAGE).toContain('パスワードを設定して次へ')
    expect(PAGE).not.toContain('→ パスワードを設定して次へ')
  })

  it('運営だけの画面で操作が記録されることを書く', () => {
    expect(PAGE).toContain('この画面は運営メンバーだけが開けます。操作はすべて記録されます。')
  })
})
