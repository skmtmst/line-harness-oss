import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8')
/* 完全切り替え：v7 の page.tsx は捨て、V8 の new-v8.tsx と basics-form-v8.tsx を見る。 */
const LIST = read('list-v8.tsx')
const CREATE = read('new', 'new-v8.tsx')
const BASICS = read('basics-form-v8.tsx')
const API = read('..', '..', 'lib', 'api.ts')

/**
 * 作る画面でフォルダを選べること（設計 Pencil `uJP22` STEP1「基本設定」）。
 *
 * 一覧は 156 からフォルダで分けられる（行の移動プルダウンが
 * `api.reminders.update(id, { folderId })` を呼ぶ）。**作る画面だけが
 * 「準備中です」の止まった欄のまま取り残されていた。** 一覧で分けられるのに
 * 作るときに選べないと、作ったそばから未分類へ落ち、あとで1件ずつ移し直す
 * ことになる。受け口（`api.reminders.create`）は最初から `folderId` を
 * 受け取れていたので、足りていなかったのは画面だけ。
 */
describe('リマインダのフォルダ', () => {
  it('作る画面が、止まった「準備中」の欄を持たない', () => {
    expect(CREATE).not.toContain('フォルダ分けは準備中です')
    expect(BASICS).not.toContain('フォルダ分けは準備中です')
    expect(BASICS).not.toContain('<select disabled')
  })

  it('作る画面がフォルダを読み、選んだものを保存に乗せる', () => {
    expect(BASICS).toContain("api.folders.list('reminder')")
    expect(CREATE).toContain('folderId: value.folderId || null')
  })

  it('フォルダが1つも無いときは未分類で作れ、読み込み失敗は選び直せる', () => {
    expect(BASICS).toContain('未分類')
    expect(BASICS).toContain('フォルダを読み込めませんでした')
    expect(BASICS).toContain('再読み込み')
  })

  it('一覧と受け口は前から folderId を通していた（画面だけが遅れていた）', () => {
    expect(LIST).toContain('const folderId = moveDraft || null')
    expect(LIST).toContain('api.reminders.update(id, { folderId })')
    expect(LIST).toContain("failureMessage: 'フォルダを移動できませんでした。'")
    expect(API).toContain('folderId?: string | null')
  })
})
