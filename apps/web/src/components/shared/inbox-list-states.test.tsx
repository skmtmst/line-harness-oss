import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InboxListEmpty, InboxListFailure } from './inbox-list-states'

describe('受信箱の空と失敗はほかの一覧と同じ形', () => {
  it('空は印・題・説明。絞り込み中だけ外す操作を出す', () => {
    const empty = renderToStaticMarkup(<InboxListEmpty filtered={false} onClear={() => {}} />)
    expect(empty).toContain('data-inbox-list-state="empty"')
    expect(empty).toContain('まだ会話がありません')
    expect(empty).toContain('LINE で話しかけられるとここに出ます。')
    expect(empty).not.toContain('<button')
    const filtered = renderToStaticMarkup(<InboxListEmpty filtered onClear={() => {}} />)
    expect(filtered).toContain('data-inbox-list-state="filtered-empty"')
    expect(filtered).toContain('絞り込みを外す')
  })

  it('会話とメールが両方失敗しても、知らせと「もう一度読み込む」は1つ', () => {
    const html = renderToStaticMarkup(<InboxListFailure messages={['チャットの読み込みに失敗しました。', 'メールの読み込みに失敗しました。']} onRetry={() => {}} />)
    expect(html.match(/role="alert"/g)?.length).toBe(1)
    expect(html.match(/もう一度読み込む/g)?.length).toBe(1)
    expect(html).not.toContain('text-danger underline')
    expect(renderToStaticMarkup(<InboxListFailure messages={[]} onRetry={() => {}} />)).toBe('')
  })
})
