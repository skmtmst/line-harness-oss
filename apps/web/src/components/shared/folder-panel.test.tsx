import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import FolderPanel from './folder-panel'

const rows = [
  { id: '', label: 'すべて', count: 24 },
  { id: 'f1', label: '予約配信', count: 8, onEdit: () => {}, onDelete: () => {} },
  { id: 'unfiled', label: '未分類', count: 3 },
]

describe('フォルダの縦パネル', () => {
  it('直せる行にだけ「…」を出す', () => {
    /*
     * 設計 `q76C35` は分類の行に「…」を置く。「すべて」「未分類」は
     * 実体が無いので直せない。
     */
    const html = renderToStaticMarkup(
      <FolderPanel rows={rows} activeId="" onSelect={() => {}} total="24 件" />,
    )
    expect(html).toContain('フォルダ「予約配信」の操作')
    expect(html).not.toContain('フォルダ「すべて」の操作')
    expect(html).not.toContain('フォルダ「未分類」の操作')
  })

  it('「…」は常に見える', () => {
    /*
     * 以前はカーソルを置いたときだけ出る「編集」だった。撮った絵にも
     * 写らず、名前を変えられること自体が伝わっていなかった。
     */
    const html = renderToStaticMarkup(
      <FolderPanel rows={rows} activeId="" onSelect={() => {}} total="24 件" />,
    )
    expect(html).not.toContain('opacity-0')
    expect(html).not.toContain('group-hover:opacity-100')
  })

  it('件数と総数をそのまま出す', () => {
    const html = renderToStaticMarkup(
      <FolderPanel rows={rows} activeId="" onSelect={() => {}} total="24 件" />,
    )
    expect(html).toContain('>24<')
    expect(html).toContain('>8<')
    // 取得できた0件を隠さない。
    const zero = renderToStaticMarkup(
      <FolderPanel rows={[{ id: 'f2', label: '空の箱', count: 0 }]} activeId="" onSelect={() => {}} total="0 件" />,
    )
    expect(zero).toContain('>0<')
  })
})
