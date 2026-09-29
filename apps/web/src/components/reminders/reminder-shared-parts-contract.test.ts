import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(new URL('./reminder-v6-ui.tsx', import.meta.url), 'utf8')

describe('リマインダ表示部品の共通部品とのすみ分け', () => {
  it('ボタンと状態札の動作は共通部品へ寄せる', () => {
    expect(SOURCE).toContain("import Button, { type ButtonProps } from '@/components/shared/button'")
    expect(SOURCE).toContain("from '@/components/shared/status-badge'")
    expect(SOURCE).toContain('<Button {...props}')
    expect(SOURCE).toContain('<StatusBadge tone={tone}')
  })

  it('固定5段の手順・設定要約・LINE見本はリマインダ固有として残す', () => {
    expect(SOURCE).toContain("const STEPS = ['基本設定', '対象者', '通知ステップ', '送信設定', '確認']")
    expect(SOURCE).toContain('export function ReminderWizard')
    expect(SOURCE).toContain('export function SummaryCard')
    expect(SOURCE).toContain('export function LinePreview')
  })
})
