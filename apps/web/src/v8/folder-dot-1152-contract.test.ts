import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 1152 の一覧6画面：絵に名前の前のフォルダの丸を描き足した（板 Iffil・L7zA7C・WPrd5・XIzkJ・KdFRI・ZJIyl）。
 * どの幅でも丸を出す（狭い幅で丸を消さない）。2行目の字下げは絵のとおり（リマインダだけ 1152 でも下げる）。
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCREENS = [
  'app/reminders/list-v8.tsx',
  'v8/templates/list.tsx',
  'v8/auto-replies/list.tsx',
  'v8/common-vars/list.tsx',
  'v8/affiliates/affiliators.tsx',
  'v8/mileage/earning-rules.tsx',
]

describe('1152 の一覧でも名前の前にフォルダの丸を出す', () => {
  it.each(SCREENS)('%s', (file) => {
    const source = readFileSync(join(SRC, file), 'utf8')
    expect(source).toMatch(/<FolderDotName folder=\{[^}]+\}>/)
    expect(source).not.toMatch(/<FolderDotName[^>]*dot=\{/)
  })
})
