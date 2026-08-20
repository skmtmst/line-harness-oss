import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(import.meta.url))
const APP_SHELL = join(ROOT, '..', 'app-shell.tsx')
const DASHBOARD = join(ROOT, '..', '..', 'app', 'page.tsx')
const MENU = join(ROOT, '..', '..', 'lib', 'menu.ts')

describe('Pen.dev V4を共通レイアウトの正本にする', () => {
  const shell = readFileSync(APP_SHELL, 'utf8')
  const dashboard = readFileSync(DASHBOARD, 'utf8')
  const menu = readFileSync(MENU, 'utf8')

  it('1920pxでサイドバー256px・本体1664px・左右40pxになる', () => {
    expect(shell).toContain('data-design-shell="v4-1920"')
    expect(shell).toContain('max-w-shell')
    expect(shell).toContain('lg:px-10')
    expect(shell).not.toContain('lg:px-8')
  })

  it('V4の上段と主要カードが実装から消えていない', () => {
    for (const label of [
      '今日やること',
      '対応が必要な受信',
      '写真審査',
      '今日の予約',
      '出荷予定',
      '今月の送信枠',
      '運用アラート',
      '接続状態',
      '友だち数の推移',
      '友だち追加リンク',
    ]) expect(dashboard).toContain(label)
  })

  it('V4カードの影は右1px・下1pxで統一する', () => {
    expect(dashboard).toContain('shadow-[1px_1px_2px_rgba(29,29,31,0.13)]')
    expect(dashboard).not.toContain('shadow-[1px_2px_2px_rgba(29,29,31,0.13)]')
  })

  it('V4で追加したメニューが実装から消えていない', () => {
    for (const label of ['コンバージョン', '専用機能', 'NEN配信', '写真審査', 'EC連携', 'データ移行']) {
      expect(menu).toContain(label)
    }
  })
})
