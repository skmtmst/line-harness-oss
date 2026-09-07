import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')

describe('V6 緊急停止の最終確認 U0BwS', () => {
  it('設計の720px幅と影響・理由・止まらないものの3区画を持つ', () => {
    expect(page).toContain('max-w-[720px]')
    expect(page).toContain('停止前にすでにLINEへ渡したものは取り消せません。')
    expect(page).toContain('<p className="text-xs font-bold text-ink">理由</p>')
    expect(page).toContain('<p className="text-xs font-bold text-success">止まらないもの</p>')
    expect(page).toContain('w-[280px]')
  })
})
