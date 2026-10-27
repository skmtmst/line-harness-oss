import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 失敗の文の中身は src/v8/rich-menus/errors.test.ts が関数を呼んで、
 * 一覧の各操作（読み込み・並び替え・削除・取り下げ・LINEからの削除・取り込み）で
 * その文が出ることは src/v8/rich-menus/list-ops-react.test.tsx が画面を動かして見る。
 * ここには内部の文をそのまま出す書き方に戻さない禁止の見張りだけを残す。
 */
const PAGE = readFileSync(new URL('../../v8/rich-menus/list.tsx', import.meta.url), 'utf8')
  + readFileSync(new URL('../../v8/rich-menus/errors.ts', import.meta.url), 'utf8')

describe("管理画面 リッチメニューのエラー表示", () => {
  it('APIの内部エラーを画面や警告へそのまま出さない', () => {
    expect(PAGE).not.toContain('e instanceof Error ? e.message : String(e)')
    expect(PAGE).not.toContain('LINE 公式アカウントの状態取得に失敗しました:')
  })
})
