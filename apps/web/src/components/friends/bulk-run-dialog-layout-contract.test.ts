import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(join(__dirname, 'bulk-run-dialog.module.css'), 'utf8')
const DIALOG = readFileSync(join(__dirname, 'bulk-run-dialog.tsx'), 'utf8')

describe('V8 一括操作の小窓（CYJ0L）', () => {
  it('外側・フォーカス・画面内への収まりは共通Dialogを使う', () => {
    expect(DIALOG).toContain("import Dialog from '@/components/shared/dialog'")
    expect(DIALOG).toContain('<Dialog open={open}')
    expect(DIALOG).toContain('busy={busy} footer={footer}')
    expect(CSS).not.toContain('position: fixed')
    expect(CSS).not.toContain('left: 256px')
  })
  it('操作カードは最小幅で表を押し広げず、狭い幅で列を減らす', () => {
    expect(CSS).toContain('repeat(3, minmax(0, 1fr))')
    expect(CSS).toContain('repeat(auto-fit, minmax(180px, 1fr))')
  })
})
