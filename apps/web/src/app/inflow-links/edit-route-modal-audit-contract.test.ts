import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODAL = readFileSync(join(HERE, '_components', 'edit-route-modal.tsx'), 'utf8')

describe('流入リンク編集窓の監査対応（R270・R271）', () => {
  it('R270: フォルダ空欄でも保存できる（作成と同じく任意）', () => {
    expect(MODAL).toContain(
      'const saveDisabled = submitting || !form.name.trim() || !form.refCode.trim()',
    )
    expect(MODAL, 'フォルダが必須のまま').not.toMatch(/saveDisabled = [^\n]*form\.genre/)
  })

  it('R270: フォルダ空欄は未分類として null で送る', () => {
    // 空文字のまま送ると口が400ではじく（entry-routes.ts の genre 検査）。
    expect(MODAL).toContain('genre: e.target.value.trim() ? e.target.value : null')
  })

  it('R270: 欄の呼び名は一覧と同じフォルダにする', () => {
    expect(MODAL).toContain('フォルダ（任意）')
    expect(MODAL).toContain('流入元の名前')
    expect(MODAL, 'ジャンル呼びが残っている').not.toContain('ジャンル（協力会社')
    expect(MODAL, 'ジャンル呼びが残っている').not.toContain('名前（ジャンル内')
  })

  it('R271: 作成済みの識別子は入力できず理由が分かる', () => {
    expect(MODAL).toContain('disabled={refCodeLocked || !isNew}')
    expect(MODAL).toContain('URLに出る識別子は作成後に変更できません')
  })
})
