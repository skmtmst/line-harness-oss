import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const staffSectionSource = readFileSync(new URL('./hq-staff-section.tsx', import.meta.url), 'utf8')

describe('統括設定', () => {
  it('現在の統括名を読み込み、必須100文字以内で保存する', () => {
    expect(source).toContain('api.tenants.me()')
    expect(source).toContain('api.tenants.updateName(trimmed)')
    expect(source).toContain('required')
    expect(source).toContain('maxLength={100}')
    expect(source).toContain("trimmed.length > 100")
  })

  it('権限者の一覧・追加・担当範囲変更を同じ設定画面に置く', () => {
    expect(source).toContain('<HqStaffSection />')
  })

  it('権限者の追加フォームでは管理者と閲覧のみを選べ、スタッフは選べない', () => {
    expect(staffSectionSource).toContain('<option value="admin">管理者</option>')
    expect(staffSectionSource).toContain('<option value="viewer">閲覧のみ</option>')
    expect(staffSectionSource).not.toContain('<option value="staff">スタッフ</option>')
  })
})
