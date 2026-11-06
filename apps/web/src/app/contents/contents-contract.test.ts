import { readApiSource } from '../../../scripts/test-api-source.mjs'
import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(new URL('./page.tsx', import.meta.url), 'utf8')
const DETAIL = readFileSync(new URL('../../v8/contents/media-detail-dialog.tsx', import.meta.url), 'utf8')
const API = readApiSource(new URL('../../lib/api.ts', import.meta.url), 'utf8')

/*
 * 登録メディア一覧の動きは、画面を描いて押す試験が守る。
 * - 一覧・絞り込み・並べ方・数の帯・札・フォルダ：src/v8/contents/list-view.test.tsx
 * - 削除の確認・まとめて削除：src/v8/contents/list-delete.test.tsx
 * - 登録の窓（直接送る・進み・選び直す）：src/v8/contents/media-upload-dialog.test.tsx
 * - 詳細・版の追加：media-version-compat-react / media-terms-versions-react / media-detail-*-react
 * - 差し替え：media-replacement-partial-react / media-replacement-search-react
 * - 退避と復帰：media-archive-react
 * - API 側（アカウントの指定・実ファイル形式・期限と同意・版の取り出し・退避）：apps/worker/src/routes/contents.test.ts
 * ここには、入れてはいけない書き方の見張りだけを残す。
 */
describe('V8 登録メディア一覧（禁止の見張り）', () => {
  it('寸法や長さが無いときに作り物の値で埋めない', () => {
    expect(PAGE).not.toContain("details.push('—')")
  })

  it('詳細を一覧の上の小窓にしない（設計の全面詳細）', () => {
    expect(DETAIL).not.toContain("import Dialog from '@/components/shared/dialog'")
  })

  it('使用中メディアの強制削除口を持たない', () => {
    expect(PAGE).not.toContain('force: true')
    expect(API).not.toContain("`/api/media/${id}${opts?.force ? '?force=1' : ''}`")
  })
})
