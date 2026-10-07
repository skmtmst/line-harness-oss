import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ListVideo } from 'lucide-react'
import EmptyList from './empty-list'

/**
 * 空の一覧（★V8 修正案 D-2・2026-10-07 オーナー採用）。
 * まだ1件も無い：印・題・説明・主ボタン「最初の〇〇を作る」。
 * 絞り込みで0件：題「条件に合うものがありません」・副ボタン「条件を外す」。作るボタンは出さない。
 * 閲覧のみ：作るボタンを出さない（説明だけ）。
 */
const base = {
  icon: <ListVideo aria-hidden="true" />,
  title: 'まだシナリオがありません',
  description: '友だち追加や購入をきっかけに、決めた順番でメッセージを届けます。',
  create: { label: '最初のシナリオを作る', href: '/scenarios/new' },
}

describe('空の一覧', () => {
  it('まだ1件も無いときは題・説明・主ボタンを1つ出す', () => {
    const html = renderToStaticMarkup(<EmptyList {...base} />)
    expect(html).toContain('data-empty-list="first"')
    expect(html).toContain('まだシナリオがありません')
    expect(html).toContain('友だち追加や購入をきっかけに')
    expect(html).toContain('最初のシナリオを作る')
    expect(html.match(/<a |<button /g)?.length).toBe(1)
    expect(html).not.toContain('条件を外す')
  })

  it('閲覧のみの人には作るボタンを出さない', () => {
    const html = renderToStaticMarkup(<EmptyList {...base} canCreate={false} />)
    expect(html).toContain('まだシナリオがありません')
    expect(html).not.toContain('最初のシナリオを作る')
    expect(html).not.toMatch(/<a |<button /)
  })

  it('絞り込み・検索で0件のときは「条件に合うものがありません」と「条件を外す」だけ', () => {
    const html = renderToStaticMarkup(<EmptyList {...base} filtered onClearFilters={() => undefined} />)
    expect(html).toContain('data-empty-list="filtered"')
    expect(html).toContain('条件に合うものがありません')
    expect(html).toContain('条件を外す')
    expect(html).not.toContain('まだシナリオがありません')
    expect(html).not.toContain('最初のシナリオを作る')
  })
})
