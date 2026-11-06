import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 統括の例外時の3欄も、共通の段と入力で安全に収める。
 * 3欄の名前・入力・フォルダの選択欄が出て書き換えられることは
 * components/rich-menus/rich-menu-create-form-shared.test.tsx が描いて見る。
 * ここには、狭い手書き列へ戻さない禁止の見張りと、描画では測れない「欄いっぱい」の指定だけを残す。
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
  it('3欄は縦に収める（狭い手書き列を残さない）', () => {
    const row = fieldsRow()
    expect(row).not.toContain('lg:col-span-1')
    expect(row).not.toContain('lg:col-span-3')
  })

  it('フォルダの選択欄は欄いっぱいに広がる', () => {
    const row = fieldsRow()
    expect(row).toContain('size="full"')
  })

  it('素の入力を直置きしない', () => {
    const row = fieldsRow()
    expect(row).not.toContain('<input')
  })
})
