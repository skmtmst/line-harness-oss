// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStyle } from '@line-crm/shared'
import { setTestReducedMotion } from '@/test-utils/reduced-motion'
import { StyleExperiencePlayer } from './player'
import { STYLE_EXPERIENCE_SCRIPT } from './script'
import { FORBIDDEN_DEMO_TEXT } from './demo-guard.fixture'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, prefetch() {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))

/** 器が見えているかを試験から切り替える IntersectionObserver。 */
const observers: Array<(visible: boolean) => void> = []
class FakeIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) { observers.push(visible => this.callback([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as IntersectionObserverEntry], this as unknown as IntersectionObserver)) }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() { return [] }
}

const scene = () => document.querySelector('[data-scene]')?.getAttribute('data-scene')
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const setVisible = (visible: boolean) => act(() => { observers.forEach(notify => notify(visible)) })
const setTab = (state: 'hidden' | 'visible') => act(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
})

beforeEach(() => {
  setTestReducedMotion(false)
  vi.useFakeTimers()
  observers.length = 0
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setTab('visible')
})

const renderPlayer = (props: Partial<Parameters<typeof StyleExperiencePlayer>[0]> = {}) =>
  render(<StyleExperiencePlayer script={STYLE_EXPERIENCE_SCRIPT} switcher="segmented" variant="full" data="sample" {...props} />)

describe('スタイル体験の見本の自動再生', () => {
  it('段は ms ごとに進み、最後の段の後は次のスタイルへ進む（1 つのタイマーで 3 つの画面が同じ段）', () => {
    renderPlayer()
    expect(scene()).toBe('restaurant:reserve')
    advance(3499)
    expect(scene()).toBe('restaurant:reserve')
    advance(1)
    expect(scene()).toBe('restaurant:accept')
    // 3 つの画面は 1 つの段の値を読むだけ（器 1 つに data-scene が 1 つ）。
    expect(document.querySelectorAll('[data-scene]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-pane="phone"],[data-pane="dashboard"],[data-pane="board"]')).toHaveLength(3)
    for (const ms of [3500, 3500, 3500]) advance(ms)
    expect(scene()).toBe('restaurant:thanks')
    advance(4000)
    expect(scene()).toBe('salon:reserve')
    expect(screen.getByRole('button', { name: 'サロン' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('全部版は右の画面がそろったスタイルだけを回し、標準のあとは EC、EC のあとは飲食へ戻る', () => {
    function Controlled() {
      const [style, setStyle] = useState<AccountStyle>('standard')
      return <StyleExperiencePlayer script={STYLE_EXPERIENCE_SCRIPT} style={style} onStyleChange={setStyle} switcher="segmented" variant="full" data="sample" />
    }
    render(<Controlled />)
    for (const ms of [3500, 3500, 3500, 3500, 4000]) advance(ms)
    expect(scene()).toBe('ec:follow')
    expect(screen.getByRole('button', { name: '標準・EC' }).getAttribute('aria-pressed')).toBe('true')
    for (const ms of [3500, 3500, 3500, 3500, 4000]) advance(ms)
    expect(scene()).toBe('restaurant:reserve')
    // 教室は全部版の札に出さない（LIFF の描く部分の切り出しの後）。
    expect(screen.queryByRole('button', { name: '教室・レッスン' })).toBeNull()
  })

  it('切り替えを外が持つ時は同じスタイルをくり返し、上の切り替えとできることを出さない', () => {
    const onStyleChange = vi.fn()
    renderPlayer({ style: 'salon', switcher: 'external', onStyleChange })
    expect(screen.queryByRole('group', { name: '見るスタイル' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'サロンでできること' })).toBeNull()
    for (const ms of [3500, 3500, 3500, 3500, 4000]) advance(ms)
    expect(scene()).toBe('salon:reserve')
    // 見ているスタイルを外へ変えさせない（スタイルを選ぶ画面の①が持つ）。
    expect(onStyleChange).not.toHaveBeenCalled()
  })

  it('外から渡すスタイルが変わると、そのスタイルの①から続ける', () => {
    const view = renderPlayer({ style: 'restaurant', switcher: 'external' })
    advance(3500)
    expect(scene()).toBe('restaurant:accept')
    view.rerender(<StyleExperiencePlayer script={STYLE_EXPERIENCE_SCRIPT} style={'consult' satisfies AccountStyle} switcher="external" variant="full" data="sample" />)
    expect(scene()).toBe('consult:reserve')
    advance(3500)
    expect(scene()).toBe('consult:accept')
  })

  it('切り替えを押すとそのスタイルの①へ移り、矢印キーでも移れる。hover では変わらない', () => {
    const onStyleChange = vi.fn()
    renderPlayer({ onStyleChange })
    advance(3500)
    fireEvent.mouseEnter(screen.getByRole('button', { name: '面談・相談' }))
    fireEvent.mouseOver(screen.getByRole('button', { name: '面談・相談' }))
    expect(scene()).toBe('restaurant:accept')
    fireEvent.click(screen.getByRole('button', { name: '面談・相談' }))
    expect(scene()).toBe('consult:reserve')
    expect(onStyleChange).toHaveBeenLastCalledWith('consult')
    fireEvent.keyDown(screen.getByRole('group', { name: '見るスタイル' }), { key: 'ArrowRight' })
    expect(scene()).toBe('standard:follow')
    // 見ている札を押し直すと、①の頭から数え直す。
    advance(3000)
    fireEvent.click(screen.getByRole('button', { name: '標準・EC' }))
    advance(3499)
    expect(scene()).toBe('standard:follow')
    advance(1)
    expect(scene()).toBe('standard:inbox')
  })

  it('手順を押すとその段へ移り、押した直後には進まない（その段の頭から数え直す）', () => {
    renderPlayer()
    for (const ms of [3500, 3500, 3500]) advance(ms)
    expect(scene()).toBe('restaurant:visit')
    advance(3000)
    fireEvent.click(screen.getByRole('button', { name: '受付に戻る' }))
    expect(scene()).toBe('restaurant:accept')
    advance(3499)
    expect(scene()).toBe('restaurant:accept')
    advance(1)
    expect(scene()).toBe('restaurant:remind')
    fireEvent.click(screen.getByRole('button', { name: 'お礼に進む' }))
    expect(scene()).toBe('restaurant:thanks')
  })

  it('［止める］の間は進まず、［動かす］で同じ段の頭から数え直す', () => {
    renderPlayer()
    advance(2000)
    fireEvent.click(screen.getByRole('button', { name: '止める' }))
    advance(20000)
    expect(scene()).toBe('restaurant:reserve')
    fireEvent.click(screen.getByRole('button', { name: '動かす' }))
    advance(3499)
    expect(scene()).toBe('restaurant:reserve')
    advance(1)
    expect(scene()).toBe('restaurant:accept')
  })

  it('器が見えない時・タブが裏の時は止まり、戻ると同じ段の頭から', () => {
    renderPlayer()
    advance(3000)
    setVisible(false)
    advance(20000)
    expect(scene()).toBe('restaurant:reserve')
    setVisible(true)
    advance(3499)
    expect(scene()).toBe('restaurant:reserve')
    advance(1)
    expect(scene()).toBe('restaurant:accept')
    setTab('hidden')
    advance(20000)
    expect(scene()).toBe('restaurant:accept')
    setTab('visible')
    advance(3500)
    expect(scene()).toBe('restaurant:remind')
  })

  it('部品を外す時（窓を閉じる・段から離れる）にタイマーを残さない', () => {
    const view = renderPlayer()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    view.unmount()
    advance(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('動きを減らす設定では自動で進まず、最後の段の静止。手順を押した時だけ移る', () => {
    setTestReducedMotion(true)
    renderPlayer({ style: 'salon', switcher: 'external' })
    expect(scene()).toBe('salon:thanks')
    advance(60000)
    expect(scene()).toBe('salon:thanks')
    fireEvent.click(screen.getByRole('button', { name: '予約に戻る' }))
    expect(scene()).toBe('salon:reserve')
    advance(60000)
    expect(scene()).toBe('salon:reserve')
    // 自動では進まないので［止める］は押せない形。読み上げの 1 行は出す。
    expect(screen.getByText('サロン：① 予約。担当者とメニューを選んで予約します')).toBeTruthy()
  })

  it('中の画面は押せず読み上げない。読み上げは場面の 1 行だけ', () => {
    renderPlayer()
    const frame = document.querySelector('[data-scene]') as HTMLElement
    expect(frame.hasAttribute('inert')).toBe(true)
    expect(frame.getAttribute('aria-hidden')).toBe('true')
    const live = document.querySelector('[aria-live="off"]')
    expect(live?.textContent).toBe('飲食店：① 予約。お客さまが LINE から人数・日時・コースを選んで予約します')
    advance(3500)
    expect(live?.textContent).toBe('飲食店：② 受付。予約と卓の割り当てを台帳で確認できます')
    fireEvent.click(screen.getByRole('button', { name: '止める' }))
    expect(live?.getAttribute('aria-live')).toBe('polite')
  })

  it('自動再生中は読み上げを繰り返さず、手動で選んだ段は知らせる', () => {
    renderPlayer()
    expect(document.querySelector('[aria-live="off"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '来店に進む' }))
    const live = document.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toContain('来店')
    advance(3500)
    expect(live?.getAttribute('aria-live')).toBe('off')
  })

  it('最小版はスマホ枠と数の帯だけで、手順と右の画面を出さない', () => {
    renderPlayer({ variant: 'minimal', switcher: 'external', style: 'lesson' })
    expect(document.querySelector('[data-pane="phone"]')).not.toBeNull()
    expect(document.querySelector('[data-pane="kpis"]')).not.toBeNull()
    expect(document.querySelector('[data-pane="dashboard"],[data-pane="board"]')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(scene()).toBe('lesson:reserve')
  })

  it('描いた中に本線に無い物の言葉が出ない（全スタイル・全段）', () => {
    for (const style of STYLE_EXPERIENCE_SCRIPT.order) {
      const view = renderPlayer({ style, switcher: 'external', variant: style === 'lesson' ? 'minimal' : 'full' })
      for (const step of STYLE_EXPERIENCE_SCRIPT.styles[style].scenes) {
        const text = document.body.textContent ?? ''
        for (const word of FORBIDDEN_DEMO_TEXT) expect(text.includes(word), `${style} ${step.step} ${word}`).toBe(false)
        advance(step.ms)
      }
      view.unmount()
    }
  })
})
