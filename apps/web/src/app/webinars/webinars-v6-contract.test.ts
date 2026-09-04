import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const FORM = fs.readFileSync(path.join(__dirname, '../../components/webinars/webinar-form.tsx'), 'utf8')
/** 読み込めなかった理由の文言は、試験しやすいよう別ファイルへ出した。 */
const FAILURE = fs.readFileSync(path.join(__dirname, 'webinar-load-failure.ts'), 'utf8')

describe('V6 ウェビナー一覧の契約', () => {
  it('既存データで判定できる並び順と表示件数だけを選べる', () => {
    expect(PAGE).toContain('更新が新しい順')
    expect(PAGE).toContain('作成が新しい順')
    expect(PAGE).toContain('名前順')
    /* 共通の `SelectField` へ寄せたので、配列ではなく options で並ぶ。 */
    for (const n of ['20件表示', '50件表示', '100件表示']) expect(PAGE).toContain(n)
    expect(PAGE).toContain('setPageSize(Number(event.target.value))')
    expect(PAGE).not.toContain('申込が多い順')
    expect(PAGE).not.toContain('表示件数の切り替えは準備中です')
  })

  it('公開中と下書きの条件を実際に絞り込む', () => {
    expect(PAGE).toContain("searched.filter((w) => w.status === savedFilter)")
    expect(PAGE).toContain("{ key: 'active', label: '公開中のみ' }")
    expect(PAGE).toContain("{ key: 'draft', label: '下書きのみ' }")
    expect(PAGE).not.toContain('保存した条件は準備中です')
  })

  it('保存できないフォルダ操作を出さない', () => {
    expect(PAGE).not.toContain('フォルダは準備中です')
    expect(PAGE).not.toContain('フォルダを追加')
  })

  it('選択中のLINEアカウントだけを読み、新規作成にも所属を保存する', () => {
    expect(PAGE).toContain('webinarApi.list(accountId)')
    expect(PAGE).toContain('requestGeneration.current !== generation')
    expect(PAGE).toContain('loadedAccountId === selectedAccountId ? items : []')
    expect(PAGE).toContain('上のバーでLINE公式アカウントを選んでください')
    expect(FORM).toContain("...(!initial ? { accountId: selectedAccountId } : {})")
  })

  it('表示件数を超えたウェビナーも共通ページ送りで確認できる', () => {
    expect(PAGE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(PAGE).toContain('const visibleStart = (currentPage - 1) * pageSize')
    expect(PAGE).toContain('pageCount={pageCount}')
    expect(PAGE).not.toContain('ほかに {hiddenCount} 件あります')
  })

  it('取得失敗を空の一覧と混ぜず、同じ画面で再取得できる', () => {
    /*
      文言は `webinar-load-failure.ts` へ移した。**理由ごとに言い分ける**
      ようにしたので、1つの文字列を画面に直書きする形ではなくなっている。
    */
    expect(FAILURE).toContain('ウェビナーを表示できませんでした')
    expect(FAILURE).toContain('通信状態を確認して、もう一度読み込んでください。')
    expect(PAGE).not.toContain('e instanceof Error ? e.message')
    expect(PAGE).toContain('onClick={() => void refresh()}')
    expect(PAGE).toContain('もう一度読み込む')
    /* 失敗の1枚と、空の1枚が別であること。 */
    expect(PAGE).toContain(') : loadFailure ? (')
    expect(PAGE).toContain(') : visibleItems.length === 0 ? (')
  })
})
