import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(DIR, 'date-time-field.tsx'), 'utf8')
const styles = readFileSync(join(DIR, 'date-time-field.module.css'), 'utf8')

/**
 * 監査 R156：390px 幅で日時選択の「分」欄がポップアップと画面の右へ
 * はみ出していた。時・分の選択は固定幅（standard=176px）ではなく
 * 箱の内幅へ追従する（size="full"）ことが約束。
 */
describe('日時選択の時・分欄は幅に追従する（R156）', () => {
  it('時・分の Select は size="full"（固定 176px にしない）', () => {
    // DateTimeField と TimeField の両方で、時・分それぞれに full が渡る
    const selectTags = source.match(/<Select[\s\S]*?\/>/g) ?? []
    expect(selectTags).toHaveLength(4)
    expect(selectTags.every((tag) => tag.includes('size="full"'))).toBe(true)
  })

  it('ラベル側は flex の最小幅を外して縮める（min-width: 0）', () => {
    expect(styles).toMatch(/\.timeLabel\s*\{[^}]*min-width:\s*0/)
  })
})
