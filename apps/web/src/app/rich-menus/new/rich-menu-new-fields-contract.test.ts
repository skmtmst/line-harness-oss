import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 統括の例外時の3欄も、共通の段と入力で安全に収める。
 * 狭い手書き列へ戻さず、フォルダの選択欄は欄いっぱいにする。
 */
const here = dirname(fileURLToPath(import.meta.url))
const form = readFileSync(
  join(here, '../../../v8/rich-menu-edit/compatibility-form.tsx'),
  'utf8',
)

function fieldsRow(): string {
  const start = form.indexOf('<SectionHeader title="形と画像"')
  expect(start).toBeGreaterThan(-1)
  return form.slice(start, start + 2600)
}

describe('m18s 作成画面の上の3欄は重ならない', () => {
  it('3欄は共通の入力で縦に収める（狭い手書き列を残さない）', () => {
    const row = fieldsRow()
    for (const label of ['メニュー名', 'フォルダ', 'トーク画面の下の文言']) expect(row).toContain(`<Field label="${label}"`)
    expect(row).not.toContain('lg:col-span-1')
    expect(row).not.toContain('lg:col-span-3')
  })

  it('フォルダの選択欄は欄いっぱいに広がる', () => {
    const row = fieldsRow()
    expect(row).toContain('aria-label="フォルダ"')
    expect(row).toContain('size="full"')
  })

  it('狭い欄でも中身がはみ出さない', () => {
    const row = fieldsRow()
    expect(row.match(/<TextInput/g)).toHaveLength(2)
    expect(row).toContain('<Select')
    expect(row).not.toContain('<input')
  })
})
