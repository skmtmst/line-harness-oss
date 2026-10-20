import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * #983 追加監査 LAY-06: 「管理画面の外」の取り込み画面が
 * `left-64` 固定で 390px では右の細い帯になっていた問題の契約。
 *
 * - 小画面は inset-inline:0 の全画面ビュー（左右0）
 * - PC は実在するメニュー幅（256px）ぶんだけ左を空ける（xl:left-64）
 * - 上端はモバイル固定ヘッダーとPCトップバーの実高さに合わせる
 * - 一覧行の固定5列は狭い幅で畳む
 */

const directory = dirname(fileURLToPath(import.meta.url))
// 取り込み画面の中身は external-import.tsx（★管理画面・★V8 の一覧で共有）。
const source = readFileSync(join(directory, '../../v8/rich-menus/list.tsx'), 'utf8')
  + readFileSync(join(directory, '../../v8/rich-menus/external-import.tsx'), 'utf8')
const listCss = readFileSync(join(directory, '../../v8/rich-menus/list.module.css'), 'utf8')
const importCss = readFileSync(join(directory, '../../v8/rich-menus/external-import.module.css'), 'utf8')

describe('LAY-06: 取り込み画面はビュー全幅で開く', () => {
  it('固定の left-64 だけにせず、小画面は左右0・PCはメニュー幅だけ空ける', () => {
    // `top-14 right-0 bottom-0 left-64` の無条件固定は390pxで細い帯になる
    expect(source).not.toContain('fixed top-14 right-0 bottom-0 left-64')
    expect(source).toContain('className={styles.externalLayer}')
    expect(listCss).toMatch(/\.externalLayer\s*\{[^}]*position: fixed;[^}]*inset: 0;/)
  })

  it('上端はモバイルヘッダー（68px）とPCトップバー（56px）の実高さに従う', () => {
    expect(listCss).toMatch(/\.externalLayer\s*\{[^}]*inset: 0;[^}]*overflow-y: auto;/)
    expect(source).toContain('onBack={() => setShowExternal(false)}')
  })

  it('対象メニュー行の固定5列は狭い幅では畳む', () => {
    // 48+100+110+120pxの固定列は390pxの全画面ビューでも収まらない
    expect(importCss).toContain('var(--tpl-rml-ext-thumb-w) minmax(0, 1fr) auto')
    expect(importCss).toMatch(/@media \(min-width: 640px\)\s*\{[^}]*\.menuRow[^}]*var\(--tpl-rml-ext-col-a\)/)
    expect(source).toContain('hidden text-sm font-semibold sm:block')
  })
})
