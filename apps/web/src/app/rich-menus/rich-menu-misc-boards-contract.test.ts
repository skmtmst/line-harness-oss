import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')
const LIST_CSS = readFileSync(join(HERE, 'list-v8.module.css'), 'utf8')
const CREATE = readFileSync(join(HERE, 'new', 'create-v8.tsx'), 'utf8')
const CREATE_CSS = readFileSync(join(HERE, 'new', 'create-v8.module.css'), 'utf8')

/*
 * V8 リッチメニューの細かい板（一覧・作る手順・1152）。
 * 一覧は板IDを付け（閲覧のみは `ZoKow`）、作る4手順は手順ごとに付ける。
 * 1152 の `Y9ASp`・`kmTab` は同じ画面の幅違いで、板IDは親のものを
 * 使う。畳み CSS があることをここで押さえる。v7 は変えない。
 */
describe('リッチメニューの細かい板', () => {
  it('一覧は板IDを付ける（閲覧のみは ZoKow）', () => {
    expect(LIST).toContain("data-design-node={canEdit ? 'rZEGN' : 'ZoKow'}")
  })

  it('作る4手順は手順ごとに板IDを付ける', () => {
    expect(CREATE).toContain("'JeINq'")
    expect(CREATE).toContain("'Z0uO6'")
    expect(CREATE).toContain("'OxEMM'")
    expect(CREATE).toContain("'F4gELj'")
    expect(CREATE).not.toContain('data-design-node="rich-menu-create-v8"')
  })

  it('1152（Y9ASp・kmTab）は板1100px未満で畳む', () => {
    expect(LIST_CSS).toContain('@container (max-width: 1099px)')
    expect(CREATE_CSS).toContain('@container (max-width: 1100px)')
  })
})
