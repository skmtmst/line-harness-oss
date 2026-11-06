import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(DIR, 'date-time-field.tsx'), 'utf8')
const styles = readFileSync(join(DIR, 'time-field-v8.module.css'), 'utf8')

/**
 * 監査 R156：390px 幅で日時選択の「分」欄がポップアップと画面の右へ
 * はみ出していた。時・分の選択は固定幅（standard=176px）ではなく
 * 箱の内幅へ追従する（size="full"）ことが約束。
 */
describe('日時選択の時・分欄は幅に追従する（R156）', () => {
  it('時刻の入力は親の幅へ追従する（固定176pxにしない）', () => {
    expect(source).toMatch(/<TimeFieldV8[\s\S]*?size="field"/)
    expect(source).not.toContain('<Select')
    expect(styles).toMatch(/\.root\s*\{[^}]*width:\s*100%/)
  })

  it('ラベル側は flex の最小幅を外して縮める（min-width: 0）', () => {
    expect(styles).toMatch(/\.root\s*\{[^}]*min-width:\s*0/)
  })
})
