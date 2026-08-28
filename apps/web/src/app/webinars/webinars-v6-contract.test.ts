import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const FORM = fs.readFileSync(path.join(__dirname, '../../components/webinars/webinar-form.tsx'), 'utf8')

describe('V6 ウェビナー一覧の契約', () => {
  it('既存データで判定できる並び順と表示件数だけを選べる', () => {
    expect(PAGE).toContain('更新が新しい順')
    expect(PAGE).toContain('作成が新しい順')
    expect(PAGE).toContain('名前順')
    expect(PAGE).toContain('[20, 50, 100]')
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
    expect(PAGE).toContain('activeAccountRef.current !== accountId')
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
    expect(PAGE).toContain('ウェビナーを読み込めませんでした')
    expect(PAGE).toContain('onClick={() => void refresh()}')
    expect(PAGE).toContain('もう一度読み込む')
  })
})
