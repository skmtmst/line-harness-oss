import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(new URL('../../v8/reminders/ui.tsx', import.meta.url), 'utf8')
const EDIT = readUiSource(new URL('../../v8/reminders/edit.tsx', import.meta.url), 'utf8')

describe('リマインダ表示部品の共通部品とのすみ分け', () => {
  it('ボタンと手順の動作は現役の共通部品へ寄せる', () => {
    expect(SOURCE).toContain("from '@/components/shared/button'")
    expect(SOURCE).toContain("from '@/components/templates/steps'")
    expect(SOURCE).toContain('<Button')
    expect(SOURCE).toContain('<Steps')
  })

  it('固定5段の手順・設定要約・LINE見本はリマインダ固有として残す', () => {
    expect(SOURCE).toContain('export function ReminderV8Stepper')
    expect(SOURCE).toContain('export function SummaryCardV8')
    expect(SOURCE).toContain('export function PhoneV8')
    expect(EDIT).toContain('<SummaryCardV8')
    expect(EDIT).toContain('<PhoneV8')
  })
})
