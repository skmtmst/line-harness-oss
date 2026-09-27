import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * m18s: 作成画面の上の3欄（メニュー名・フォルダ・トーク画面下の文言）は
 * 重ならない。フォルダの選択欄は決まった幅（176px）を持つため、1/6幅では
 * 隣の入力欄へはみ出して枠線が隠れた（1440px）。均等（2/2/2）に割り、
 * 選択欄は欄いっぱい（size="full"）にする。1152pxでも重ならない。戻すと赤。
 */
const here = dirname(fileURLToPath(import.meta.url))
const form = readFileSync(
  join(here, '..', '..', '..', 'components', 'rich-menus', 'rich-menu-create-form.tsx'),
  'utf8',
)

function fieldsRow(): string {
  const start = form.indexOf('lg:grid-cols-6')
  expect(start).toBeGreaterThan(-1)
  return form.slice(start, start + 2600)
}

describe('m18s 作成画面の上の3欄は重ならない', () => {
  it('3欄は均等に割る（1/6幅の欄を残さない）', () => {
    const row = fieldsRow()
    expect(row.match(/lg:col-span-2/g)?.length).toBeGreaterThanOrEqual(3)
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
    expect(row.match(/min-w-0 lg:col-span-2/g)?.length).toBeGreaterThanOrEqual(3)
  })
})
