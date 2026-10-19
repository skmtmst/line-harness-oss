import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../../v8/emergency/control.tsx', import.meta.url), 'utf8')

describe('V8 緊急停止の最終確認 EA8rM', () => {
  it('現役の共通Dialogで対象・理由・止まらないものを確認し、低い画面でも閉じ込めない', () => {
    expect(page).toContain("designNode={confirmMode === 'stop' ? 'EA8rM'")
    expect(page).toContain('停止前にすでに LINE へ渡したものは取り消せません。')
    expect(page).toContain('止める対象：{accountName}')
    expect(page).toContain('label="止める理由"')
    expect(page).toContain('止まらないもの：')
    const css = readFileSync(join(import.meta.dirname, '../../components/shared/dialog.module.css'), 'utf8')
    expect(css).toMatch(/max-height:[^;]*(?:100dvh|100vh)/)
    expect(css).toContain('overflow-y: auto')
  })
})
