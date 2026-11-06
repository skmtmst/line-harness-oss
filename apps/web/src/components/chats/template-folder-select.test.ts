import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const VIEW = readFileSync(join(HERE, '../../v8/inbox-chat/template-picker-view.tsx'), 'utf8')

/*
 * 受信箱のテンプレートフォルダの禁止の見張り。
 * フォルダの列で選べること・未分類・失敗・アカウント切替は template-picker-folders-react.test.tsx と
 * template-picker-v8.test.tsx、folder_id の渡し方は template-list-page-query.test.ts、
 * 親を選んだとき子も含める・未分類だけを返すのは Worker の templates-picker-filter.test.ts が見る。
 */
describe('受信箱のテンプレートフォルダ', () => {
  it('フォルダを古いプルダウンで選ばせない', () => {
    expect(VIEW).not.toContain('<select')
  })
})
