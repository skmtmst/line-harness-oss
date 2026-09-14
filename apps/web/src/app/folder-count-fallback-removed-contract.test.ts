import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8')

const SCENARIOS = read('scenarios', 'page.tsx')
const REMINDERS = read('reminders', 'page.tsx')
const BROADCASTS = read('broadcasts', 'page.tsx')
const AUTO_REPLIES = read('auto-replies', 'page.tsx')
const TEMPLATES = read('templates', 'page.tsx')
const CONTENTS = read('contents', 'page.tsx')
const VARS = read('contents', 'vars', 'page.tsx')

/**
 * フォルダ件数の `??` フォールバック（現在ページの行だけを数える）が
 * 消えていることを固定する（#631）。
 *
 * このフォールバックがあると、値が来なくても数字が出てしまい、
 * しかもそれは別の母集団（現在ページの行数）になる。司令塔裁定の
 * 「これがこの票でいちばん大事な指示」への直接の証拠。
 */
describe('フォルダ件数フォールバックの削除(#631)', () => {
  it('scenarios: scenarios.filter(...).length でフォルダ件数を数えていない', () => {
    expect(SCENARIOS).not.toMatch(/scenarios\.filter\(.*folderId.*\)\.length/)
    expect(SCENARIOS).toContain('f.itemCount')
  })

  it('reminders: reminders.filter(...).length でフォルダ件数を数えていない', () => {
    expect(REMINDERS).not.toMatch(/reminders\.filter\(.*folderId.*\)\.length/)
    expect(REMINDERS).toContain('folder.itemCount')
    // 型に無い itemCount を独自キャストで足していた拡張型を消した(#631)。
    // 型に足せば、来ていない経路は型エラーになる。
    expect(REMINDERS).not.toContain('VisualFolder')
    expect(REMINDERS).not.toContain('as VisualFolder')
  })

  it('broadcasts: broadcasts.filter(...).length でフォルダ件数を数えていない', () => {
    expect(BROADCASTS).not.toMatch(/broadcasts\.filter\(\(b\) => b\.folderId === f\.id\)\.length/)
    expect(BROADCASTS).toContain('f.itemCount')
  })

  it('auto-replies: 独自拡張型のキャストと現在ページの行数計算をしていない(#721)', () => {
    expect(AUTO_REPLIES).not.toContain('VisualFolder')
    expect(AUTO_REPLIES).not.toContain('as VisualFolder')
    expect(AUTO_REPLIES).not.toMatch(/\.itemCount \?\? items\.filter/)
    expect(AUTO_REPLIES).not.toMatch(/items\.filter\(\(r\) => r\.folderId === f\.id\)\.length/)
    expect(AUTO_REPLIES).not.toMatch(/items\.filter\(\(r\) => !r\.folderId\)\.length/)
    expect(AUTO_REPLIES).toContain('f.itemCount')
    expect(AUTO_REPLIES).toContain('unfiledCount')
  })

  it('templates: 現在ページの行数でフォルダ件数を数えていない(#721)', () => {
    expect(TEMPLATES).not.toMatch(/templates\.filter\(\(t\) => t\.folderId === folder\.id\)\.length/)
    expect(TEMPLATES).not.toMatch(/templates\.filter\(\(t\) => t\.folderId === null\)\.length/)
    expect(TEMPLATES).toContain('folder.itemCount')
    expect(TEMPLATES).toContain('unfiledCount')
  })

  it('contents・vars: 件数未対応の種別では件数を出さず「—」にする(#721)', () => {
    // kind=media・common_var は API が件数を返さない。読み込み済み範囲の
    // 行数を出す計算が残っていると、黙って別の母集団にすり替わる。
    expect(CONTENTS).not.toMatch(/items\.filter\(\(item\) => item\.folderId === folder\.id\)\.length/)
    expect(CONTENTS).not.toMatch(/items\.filter\(\(item\) => item\.folderId === null\)\.length/)
    expect(CONTENTS).toContain('folder.itemCount')
    expect(VARS).not.toMatch(/items\.filter\(\(item\) => item\.folderId === folder\.id\)\.length/)
    expect(VARS).not.toMatch(/items\.filter\(\(item\) => item\.folderId === null\)\.length/)
    expect(VARS).toContain('folder.itemCount')
  })

  it('3画面とも「未分類」の件数はAPIから来た値(unfiledCount)を使い、現在ページのフィルタ計算をしていない', () => {
    expect(SCENARIOS).not.toMatch(/scenarios\.filter\(\(sc\) => !sc\.folderId\)\.length/)
    expect(SCENARIOS).toContain('unfiledCount')
    expect(REMINDERS).not.toMatch(/reminders\.filter\(\(item\) => !item\.folderId\)\.length/)
    expect(REMINDERS).toContain('unfiledCount')
    expect(BROADCASTS).not.toMatch(/broadcasts\.filter\(\(b\) => !b\.folderId\)\.length/)
    expect(BROADCASTS).toContain('unfiledCount')
  })
})
