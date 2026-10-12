import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8')
const body = read('v8/tags/tags-tab.tsx')
const root = read('v8/tags/list.tsx')

describe('V8タグ画面の作る操作の置き場所', () => {
  it('作る操作はフォルダ欄にまとめ、畳まれた幅にも入口を出す', () => {
    expect(body).toContain('createAction={createButton(true)}')
    expect(body).toContain('{createButton(false)}')
    expect(body).toContain('addFolderLabel="フォルダを追加"')
    expect(body).toContain('<Button href="/tags/new" variant="primary"')
  })
  it('見出しの右にはCSVで一括登録を置く', () => {
    const actions = root.slice(root.indexOf('const actions ='), root.indexOf("tab === 'marks' ? (", root.indexOf('const actions =')))
    expect(actions).toContain('CSVで一括登録')
    expect(actions).not.toContain('/tags/new')
  })
})
