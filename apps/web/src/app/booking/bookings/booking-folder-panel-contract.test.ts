import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('予約管理のメニュー欄', () => {
  it('独自行ではなく共通FolderPanelでメニューを絞り込む', () => {
    expect(PAGE).toContain("import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'")
    expect(PAGE).toContain('style={FOLDER_RAIL_STYLE}')
    expect(PAGE).toContain('xl:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]')
    expect(PAGE).toContain('<FolderPanel')
    expect(PAGE).toContain('heading="メニュー"')
    expect(PAGE).toContain('activeId={menuFilter}')
    expect(PAGE).toContain('onSelect={setMenuFilter}')
    expect(PAGE).not.toContain('function FolderRow(')
  })
})
