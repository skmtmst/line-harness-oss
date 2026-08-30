import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PICKER = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'template-picker.tsx'),
  'utf8',
)

/** テンプレート選択（設計 `NfgOs` 2-2 ／ `NWbuF` 2-6 ／ `TUveA` 2-11）。 */
describe('テンプレート選択', () => {
  it('「よく使う」を先頭5件で作らない', () => {
    /*
     * 前は `filtered.slice(0, 5)` を「よく使う」と呼んでいた。使った回数も
     * 選んだ覚えも見ていないので、測っていないことを測ったように見せていた。
     */
    expect(PICKER).not.toContain('filtered.slice(0, 5)')
    expect(PICKER).toContain('filterFavorites(filtered, favorites)')
  })

  it('行ごとに★で登録できる', () => {
    expect(PICKER).toContain('star(template.id)')
    expect(PICKER).toContain('よく使うに登録する')
    expect(PICKER).toContain('よく使うから外す')
  })

  it('札は登録されているひな形にだけ出す', () => {
    // 絞り込みの状態で出すと、選んだものすべてに札が付く。
    expect(PICKER).not.toContain("{category === 'frequent' && <span")
    expect(PICKER).toContain('favorites.includes(selected.id) &&')
  })

  it('1件も登録が無いときに、その理由を言う', () => {
    expect(PICKER).toContain('よく使うに登録したひな形はまだありません')
  })

  it('更新日を出し、読めなければ「—」にする', () => {
    expect(PICKER).toContain('updatedLabel(selected.updatedAt)')
  })
})
