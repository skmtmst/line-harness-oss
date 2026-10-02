// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import LinePreview from './line-preview'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

/**
 * LINEプレビュー共通部品（B-6、★V7）。
 *
 * ばらばらだった枠（青い地・緑の枠・濃い緑・白）を1つにそろえる。
 * 中身は各画面の描き方のまま、枠だけが共通。
 */
describe('LINEプレビュー共通部品', () => {
  it('題「LINEプレビュー」と中身を出す', () => {
    const html = renderToStaticMarkup(
      <LinePreview>
        <p>こんにちは</p>
      </LinePreview>,
    )
    expect(html).toContain('LINEプレビュー')
    expect(html).toContain('こんにちは')
    expect(html).toContain('aria-label="LINEプレビュー"')
  })

  it('注の文は本文に出さず、題の横の？に入れる', () => {
    const html = renderToStaticMarkup(
      <LinePreview note="実際のLINE表示に近いプレビューです">
        <p>こんにちは</p>
      </LinePreview>,
    )
    // 閉じている？の中身は出さない（箱を高くしない）。
    expect(html).not.toContain('実際のLINE表示に近いプレビューです')
    expect(html).toContain('LINEプレビューの説明')
  })

  it('？を開くと注の文が出る', () => {
    render(
      <LinePreview note="実際のLINE表示に近いプレビューです">
        <p>こんにちは</p>
      </LinePreview>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'LINEプレビューの説明' }))
    expect(screen.getByRole('note').textContent).toContain('実際のLINE表示に近いプレビューです')
  })

  it('届く日時の札と送り主は見えるまま残す', () => {
    const html = renderToStaticMarkup(
      <LinePreview caption="2026/09/26 10:00 に届きます" accountName="LINE公式アカウント">
        <p>こんにちは</p>
      </LinePreview>,
    )
    // 動く情報（日時・送り主）は ? に隠さない。
    expect(html).toContain('2026/09/26 10:00 に届きます')
    expect(html).toContain('LINE公式アカウント')
  })

  it('まだ無いときは空の箱で出す', () => {
    const html = renderToStaticMarkup(<LinePreview empty="本文を書くと、ここに出ます" />)
    expect(html).toContain('本文を書くと、ここに出ます')
    expect(html).not.toContain('こんにちは')
  })

  it('v7 と v8 の枠を両方は描かない（<html data-theme> で1つに決める）', () => {
    // v7（未設定）ではパネルだけ。スマホの帯（9:41・メニュー）は出ない。
    const v7 = render(
      <LinePreview>
        <p>こんにちは</p>
      </LinePreview>,
    )
    expect(v7.container.querySelectorAll('section[aria-label="LINEプレビュー"]')).toHaveLength(1)
    expect(screen.queryByText('9:41')).toBeNull()
    v7.unmount()

    // v8 ではスマホの枠だけ。中身はトークの中へ入る。
    document.documentElement.dataset.theme = 'v8'
    const v8 = render(
      <LinePreview>
        <p>こんにちは</p>
      </LinePreview>,
    )
    expect(v8.container.querySelectorAll('section[aria-label="LINEプレビュー"]')).toHaveLength(1)
    expect(screen.getByText('9:41')).toBeTruthy()
    expect(screen.getByText('メニュー')).toBeTruthy()
    expect(screen.getByText('こんにちは')).toBeTruthy()
  })

  it('枠の色は生の色値ではなくトークンで読む', () => {
    const tsx = read('line-preview.tsx')
    // トーク背景色のトークンを使い、#16進も素の Tailwind 色も書かない。
    expect(tsx).toContain('bg-line-talk')
    expect(tsx).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(tsx).not.toMatch(/bg-(white|black|gray|slate|blue|green|red)-/)
    // ★V8 の枠だけモジュール CSS に切り出した（`cfVyj` の板の決まり）。
    // モジュール内も値はトークンだけ。生の #16進・rgb() を置かない。
    const css = read('line-preview.module.css')
    expect(css).toContain("[data-theme='v8']")
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(css).not.toMatch(/\brgba?\(/)
  })
})
