import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PANEL = readFileSync(new URL('./folder-panel.tsx', import.meta.url), 'utf8')

describe('共通フォルダ欄', () => {
  it('テンプレート画面の252px幅を全画面用の1値として公開する', () => {
    expect(PANEL).toContain("export const FOLDER_RAIL_WIDTH = '15.75rem'")
    expect(PANEL).toContain('lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]')
  })

  it('フォルダ追加操作を一覧の下へ出す', () => {
    expect(PANEL).toContain('onAddFolder?: () => void')
    expect(PANEL).toContain("addFolderLabel = 'フォルダを追加'")
    expect(PANEL.indexOf('{rows.map')).toBeLessThan(PANEL.indexOf('onClick={onAddFolder}'))
    expect(PANEL).toContain('className="w-full"')
  })
})
