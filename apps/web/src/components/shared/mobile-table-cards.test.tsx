// @vitest-environment happy-dom
/*
 * ★V7 監査の直し A（`LD96g`）：スマホ（〜767px）の一覧カードの描画試験。
 *
 * 本物の共有部品（`MobileTableCards`）を描いて確かめる。モックだけの
 * 形骸にしない。390px相当では名前が見え、横はみ出しの原因（固定幅・
 * `truncate` による1行刈り・`break-all` による縦積み）が無いこと。
 * 1440px相当ではカードが出ないこと（表の側が出す）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MobileTableCards from './mobile-table-cards'

let host: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  root = null
  host.remove()
  vi.unstubAllGlobals()
})

async function mount(node: React.ReactElement) {
  root = createRoot(host)
  await act(async () => {
    root!.render(node)
  })
}

const LONG_NAME = '秋のトリミング相談会の案内と初回来店のお礼と定期便の申し込み完了のお知らせ'

describe('1行目：名前は消さず2行まで＋状態の札', () => {
  it('長い名前は全文がDOMに残り、全文はtitleで読める', async () => {
    await mount(
      <MobileTableCards
        items={[{ id: 'a', name: LONG_NAME, status: <span>使用中</span> }]}
      />,
    )
    const name = host.querySelector('li p')
    expect(name?.textContent).toBe(LONG_NAME)
    expect(name?.getAttribute('title')).toBe(LONG_NAME)
  })

  it('名前を1行に刈らない（truncate禁止）・縦に積まない（break-all禁止）', async () => {
    await mount(
      <MobileTableCards items={[{ id: 'a', name: LONG_NAME }]} />,
    )
    const name = host.querySelector('li p')
    expect(name?.className).toContain('line-clamp-2')
    expect(name?.className).not.toContain('truncate')
    expect(name?.className).not.toContain('break-all')
  })

  it('状態が無い行は札の枠だけ残さない', async () => {
    await mount(
      <MobileTableCards items={[{ id: 'a', name: '名前だけ', summary: '要点' }]} />,
    )
    expect(host.querySelector('li > div > div')).toBeNull()
  })
})

describe('2・3行目：要点・主な数字・操作', () => {
  it('要点・主な数字・主な操作・「…」が1件に並ぶ', async () => {
    await mount(
      <MobileTableCards
        items={[{
          id: 'a',
          name: '初回来店のお礼',
          summary: 'テンプレート・テキスト＋画像・差し込みあり',
          metric: '使っている場所 3',
          primaryAction: <button type="button">編集</button>,
          moreAction: <button type="button" aria-label="その他操作">…</button>,
        }]}
      />,
    )
    expect(host.textContent).toContain('テンプレート・テキスト＋画像・差し込みあり')
    expect(host.textContent).toContain('使っている場所 3')
    expect(host.textContent).toContain('編集')
    expect(host.querySelector('[aria-label="その他操作"]')).not.toBeNull()
  })
})

describe('出し分け：767px以下だけカード', () => {
  it('カードの器はmd:hidden（768px以上では出ない）', async () => {
    await mount(<MobileTableCards items={[{ id: 'a', name: '名前' }]} />)
    expect(host.querySelector('ul')?.className).toContain('md:hidden')
  })
})

describe('行を開く場所：表の行と同じ動き', () => {
  it('行を選ぶと開き、内側の操作は行へ伝えない', async () => {
    const opened: string[] = []
    await mount(
      <MobileTableCards
        items={[{
          id: 't1',
          name: '初回来店のお礼',
          primaryAction: <button type="button">編集</button>,
          onSelect: () => { opened.push('t1') },
        }]}
      />,
    )
    const row = host.querySelector('li')
    expect(row?.getAttribute('role')).toBe('link')
    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(opened).toEqual(['t1'])
    await act(async () => {
      host.querySelector('li button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // 内側の「編集」は行の選択へ伝わらない。
    expect(opened).toEqual(['t1'])
  })
})
