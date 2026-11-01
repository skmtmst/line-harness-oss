import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * #983 追加監査 LAY-06: 「管理画面の外」の取り込み画面が
 * 狭い幅でも使えることを実DOMと三幅のブラウザで確かめる。
 * このファイルは候補行の列が狭い幅で畳まれることを守る。
 */

const directory = dirname(fileURLToPath(import.meta.url))
// 取り込み画面の中身は external-import.tsx（★管理画面・★V8 の一覧で共有）。
const source = readFileSync(join(directory, '../../v8/rich-menus/list.tsx'), 'utf8')
  + readFileSync(join(directory, '../../v8/rich-menus/external-import.tsx'), 'utf8')
const importCss = readFileSync(join(directory, '../../v8/rich-menus/external-import.module.css'), 'utf8')

describe('取り込み候補の狭い行', () => {
  it('対象メニュー行の固定5列は狭い幅では畳む', () => {
    // 48+100+110+120pxの固定列は390pxの全画面ビューでも収まらない
    expect(importCss).toContain('var(--tpl-rml-ext-thumb-w) minmax(0, 1fr) auto')
    expect(importCss).toMatch(/@media \(min-width: 640px\)\s*\{[^}]*\.menuRow[^}]*var\(--tpl-rml-ext-col-a\)/)
    expect(source).toContain('hidden text-sm font-semibold sm:block')
  })
})
