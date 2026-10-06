import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const LIST_V8 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'list-v8.tsx'), 'utf8')

/** 共通情報の削除の窓（板 `xxKtW`）の言葉を絵に合わせる歯止め。 */
describe('xxKtW 削除の窓の言葉', () => {
  it('差し替えの選択肢と実行ボタンは「消す」でそろえる', () => {
    expect(LIST_V8).toContain('別の共通情報に差し替えて消す（おすすめ）')
    expect(LIST_V8).toContain('差し替えて消す')
    expect(LIST_V8).not.toContain('差し替えて削除')
  })

  it('止める選択肢と差し替え先の見出しを出す', () => {
    expect(LIST_V8).toContain('消さずに止める')
    expect(LIST_V8).toContain('差し替え先')
    expect(LIST_V8).toContain('どうしますか')
  })
})
