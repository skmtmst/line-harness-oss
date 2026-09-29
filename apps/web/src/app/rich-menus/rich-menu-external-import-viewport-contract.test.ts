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
const source = readFileSync(join(directory, 'page.tsx'), 'utf8')

describe('LAY-06: 取り込み画面はビュー全幅で開く', () => {
  it('固定の left-64 だけにせず、小画面は左右0・PCはメニュー幅だけ空ける', () => {
    // `top-14 right-0 bottom-0 left-64` の無条件固定は390pxで細い帯になる
    expect(source).not.toContain('fixed top-14 right-0 bottom-0 left-64')
    expect(source).toContain('inset-x-0')
    expect(source).toContain('xl:left-64')
  })

  it('上端はモバイルヘッダー（68px）とPCトップバー（56px）の実高さに従う', () => {
    expect(source).toContain('top-[var(--mobile-header-height)]')
    expect(source).toContain('xl:top-14')
  })

  it('対象メニュー行の固定5列は狭い幅では畳む', () => {
    // 48+100+110+120pxの固定列は390pxの全画面ビューでも収まらない
    expect(source).toContain('grid-cols-[48px_minmax(0,1fr)_auto]')
    expect(source).toContain('sm:grid-cols-[48px_minmax(0,1fr)_100px_110px_120px]')
  })
})
