import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 書き込み系の取りこぼしをなくす。
 * 動きは画面を動かして見る。
 * - 並び替えは隠れている行も含めて1回で送る：src/v8/rich-menus/list-ops-react.test.tsx・list-reorder-all.test.tsx
 * - 公開の失敗の文は下書きの保存の成否で分ける：app/rich-menus/new/create-action-failures.test.ts
 * - 作成直後のフォルダは作成の口で決める：app/rich-menus/new/create-ops-react.test.tsx
 * - 一括適用のやり直しは同じ鍵、条件を変えたら新しい鍵：components/rich-menus/apply-to-tag-modal-key-react.test.tsx
 * ここには途中で失敗しうる送り方に戻さない禁止の見張りだけを残す。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const LIST_PAGE = readFileSync(join(HERE, '../../v8/rich-menus/list.tsx'), 'utf8')
const NEW_PAGE = readUiSource(new URL('../../v8/rich-menus/new/create.tsx', import.meta.url), 'utf8')

describe('書き込みの送り方', () => {
  it('並び替えを全件ぶんの PATCH の並列に戻さない', () => {
    // 途中失敗で順番が中途半端に残る投げ方に戻さない。
    expect(LIST_PAGE).not.toContain('Promise.all(')
  })

  it('作成後にフォルダを付け直す2口目を戻さない', () => {
    // 失敗を握りつぶして未分類にしていた2口目に戻さない。
    expect(NEW_PAGE).not.toContain('api.richMenuGroups.update(res.data.id, { folderId })')
  })
})
