// @vitest-environment happy-dom
/*
 * #708 監査6: a11y第2弾の受入試験。
 *
 * - 09/16: 種別切替のタブ行が tablist/tab の役割を持ち、
 *   左右の矢印キーでタブ間を移動できる（開くのは Enter/Space/クリック）
 * - 19: /conversions のタブ側と左メニューの選択が一致する
 *   （案件・成果承認などは「成果とアフィリエイト」、成果地点・レポートは「コンバージョン」）
 * - 隠れ動線: 受付枠 /booking/staff/shifts がメニュー上の所属を持つ
 *   （担当者は「自分の勤務」、管理者は「予約設定」）
 * - 10: ウェビナー画面で輪郭を消す focus:outline-none を使わない
 *   （globals.css の標準リングに統一したので、消すとキーボードの
 *   輪郭まで消える）
 */
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { Tabs } from '../components/shared/tabs'
import { menuOwnerForScreen } from '../lib/menu'

const HERE = dirname(fileURLToPath(import.meta.url))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('#708 タブ行の役割とキー操作（09/16）', () => {
  const renderTabs = async (current = 'b') => {
    const onClick = vi.fn()
    await act(async () => {
      root.render(
        <Tabs
          label="配信の種類"
          items={[
            { label: 'あいさつ', current: current === 'a', onClick },
            { label: 'フォーム', current: current === 'b', onClick },
            { label: '流入別', current: current === 'c', onClick },
          ]}
        />,
      )
    })
    return { onClick }
  }

  it('tablist と tab の役割を持ち、選択中だけ aria-selected', async () => {
    await renderTabs()
    const list = container.querySelector('[role="tablist"]')
    expect(list).not.toBeNull()
    expect(list?.getAttribute('aria-label')).toBe('配信の種類')
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(tabs).toHaveLength(3)
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
  })

  it('Tabキーの入口は選択中のタブだけ（roving tabindex）', async () => {
    await renderTabs()
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1])
  })

  it('右矢印で次のタブへフォーカスが移り、左矢印で戻る', async () => {
    await renderTabs()
    const list = container.querySelector<HTMLElement>('[role="tablist"]')!
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
    tabs[1].focus()
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[2])
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[0]) // 端で回る
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tabs[2])
    fireEvent.keyDown(list, { key: 'Home' })
    expect(document.activeElement).toBe(tabs[0])
    fireEvent.keyDown(list, { key: 'End' })
    expect(document.activeElement).toBe(tabs[2])
  })

  it('選択中のタブもフォーカスできる（disabled化しない）', async () => {
    await renderTabs()
    const current = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!
    expect(current.tagName).toBe('BUTTON')
    expect((current as HTMLButtonElement).disabled).toBe(false)
    current.focus()
    expect(document.activeElement).toBe(current)
  })
})

describe('#708 画面→左メニューの所属（19・隠れ動線）', () => {
  it('成果とアフィリエイト側のタブは affiliates が選ばれる', () => {
    for (const tab of ['affiliates', 'offers', 'approvals', 'payment']) {
      expect(menuOwnerForScreen('/conversions', `?tab=${tab}`), tab).toEqual(['affiliates'])
    }
  })

  it('コンバージョン側のタブは conversions が選ばれる', () => {
    for (const tab of ['points', 'report']) {
      expect(menuOwnerForScreen('/conversions', `?tab=${tab}`), tab).toEqual(['conversions'])
    }
  })

  it('受付枠は「自分の勤務」を優先し、管理者は「予約設定」へ畳める', () => {
    expect(menuOwnerForScreen('/booking/staff/shifts', '')).toEqual(['booking-own-shifts', 'booking-menus'])
    expect(menuOwnerForScreen('/booking/staff/shifts', '?staff_id=x')).toEqual(['booking-own-shifts', 'booking-menus'])
  })
})

describe('#708 ウェビナーのフォーカス可視性（10）', () => {
  const WEBINAR_SOURCES = [
    'webinars/page.tsx',
    'webinars/new/page.tsx',
    'webinars/edit/page.tsx',
  ]

  it('輪郭を消す focus:outline-none を使わない', () => {
    /*
     * かつては focus:outline-none + focus:ring-* の組で独自リングを
     * 描いていたが、★V7 §15 で globals.css の標準リング（2px・
     * action 色・外側に2pxの隙間・キーボード時だけ）へ統一した。
     * focus:outline-none は utilities 層で base 層の輪郭を潰すため、
     * 残っているとキーボードの輪郭だけ消える。
     */
    for (const rel of WEBINAR_SOURCES) {
      const src = readFileSync(join(HERE, rel), 'utf8')
      for (const [index, line] of src.split('\n').entries()) {
        expect(
          /focus:outline-none|focus:ring-/.test(line),
          `${rel}:${index + 1} で独自リングを使っている`,
        ).toBe(false)
      }
    }
  })
})
