import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #975 U052: 型の選択肢が「型名 — 説明」の1行で、390pxだと説明が切れていた。
 * 選択欄は型名だけを全幅で出し、説明は選択中の型ぶんを欄の下へ分離する。
 */
describe('友だち情報欄の型選択（#975 U052）', () => {
  it('選択肢は型名だけにし、説明を埋め込まない', () => {
    expect(PAGE).toContain('options={TYPES.map((item) => ({ value: item, label: FIELD_TYPE_LABELS[item] }))}')
    // 「型名 — 説明」の連結した選択肢へ戻さない（閉じた欄で切れる原因）。
    expect(PAGE).not.toContain(' — ${FIELD_TYPE_HINTS')
    expect(PAGE).not.toContain('FIELD_TYPE_LABELS[type]} —')
  })

  it('選択中の型の用途は選択欄の下へ出す', () => {
    const select = PAGE.indexOf('aria-label="友だち情報欄の種類"')
    const hint = PAGE.indexOf('{FIELD_TYPE_HINTS[type]}')
    expect(select).toBeGreaterThan(-1)
    expect(hint).toBeGreaterThan(select)
  })

  it('全型の名前と用途の一覧を残す', () => {
    // 選んでいない型の用途もこの一覧で確認できる。
    expect(PAGE).toContain('FIELD_TYPE_LABELS[item]}（${FIELD_TYPE_HINTS[item]}）')
  })
})
