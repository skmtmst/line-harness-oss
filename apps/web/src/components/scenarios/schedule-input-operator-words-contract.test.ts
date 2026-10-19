import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const COMPONENT = readFileSync(new URL('./schedule-input.tsx', import.meta.url), 'utf8')

describe('V6 シナリオ配信時刻の案内', () => {
  it('運用者が判断できる言葉で遅れる可能性を説明する', () => {
    expect(COMPONENT).toContain('配信時刻は5分単位で処理するため')
    expect(COMPONENT).toContain('指定時刻から最大5分遅れる場合があります')
  })

  it('内部の実行方式を画面へ出さない', () => {
    expect(COMPONENT).not.toContain('cron が')
  })
})
