import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const SHELL = readFileSync(join(DIR, '..', 'app-shell.module.css'), 'utf8')
const SIDEBAR = readFileSync(join(DIR, 'sidebar.module.css'), 'utf8')

/**
 * 外側のすき間（板 `zUg8S`）。
 *
 * 左メニューと白い板の間は 12、右12・下12。白い板は上の帯の下から
 * 画面の下12まで伸ばす。左メニューは画面の高さいっぱいで、項目が多い
 * ときは nav だけ縦に送る。
 */
describe('zUg8S 外側のすき間', () => {
  it('白い板は左メニューと12あける（右12・下12・左12）', () => {
    expect(SHELL).toContain('margin: 0 12px 12px 12px;')
  })

  it('左メニューは画面の高さいっぱい（100dvh）', () => {
    expect(SIDEBAR).toContain('height: 100dvh;')
  })

  it('項目が多いときは nav だけ縦に送る', () => {
    expect(SIDEBAR).toContain('overflow-y: auto;')
  })

  it('nav が伸びて「設定」と版を下端に固定する', () => {
    expect(SIDEBAR).toContain('flex: 1;')
  })
})
