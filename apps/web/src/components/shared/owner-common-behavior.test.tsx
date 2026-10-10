// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import Card from './card'
import { CustomerInfoRail } from './customer-info-panel'
import { ResponsiveFilterChips } from './list-toolbar'
import FilterChip from './filter-chip'

vi.mock('next/link', () => ({ default: ({children,...props}: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete document.documentElement.dataset.theme })

test.each([48,49])('横の箱：高さの差%dの境目で、そろえるか上にそろえるかを変える', async difference => {
  document.documentElement.dataset.theme = 'v8'
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function () {
    const height = this.dataset.natural ? Number(this.dataset.natural) : 180
    return { x:0,y:0,left:0,top:0,right:800,bottom:height,width:800,height,toJSON:()=>({}) }
  })
  const view = render(<div style={{display:'flex',flexDirection:'row'}}><Card data-natural="100">短い箱</Card><Card data-natural={String(100+difference)}>長い箱</Card></div>)
  await act(async () => { await new Promise(resolve => setTimeout(resolve,60)) })
  const cards = view.container.querySelectorAll<HTMLElement>('[data-design-part="card"]')
  expect([...cards].map(card=>parseFloat(card.style.minHeight))).toEqual(difference <=48 ? [148,148] : [0,0])
  expect([...cards].map(card=>card.style.alignSelf)).toEqual(['flex-start','flex-start'])
})

test('狭い顧客欄は同じ情報を小窓で開き、閉じれば本文から畳む', async () => {
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:900,bottom:900,width:900,height:900,toJSON:()=>({})})
  render(<div><CustomerInfoRail><p>顧客の情報</p></CustomerInfoRail></div>)
  expect(screen.queryByText('顧客の情報')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'顧客情報'}))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(screen.getByText('顧客の情報')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'閉じる'}))
  // 閉じる遷移後も閲覧の状態は変えない。
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,250))})
  expect(screen.queryByText('顧客の情報')).toBeNull()
})

test('札から選ぶ欄に畳んでも、同じ条件変更を実行する', async () => {
  document.documentElement.dataset.theme = 'v8'
  const all=vi.fn(), active=vi.fn()
  const view=render(<ResponsiveFilterChips label="状態"><FilterChip selected onChange={all}>すべて</FilterChip><FilterChip selected={false} onChange={active}>有効</FilterChip></ResponsiveFilterChips>)
  fireEvent.click(view.container.querySelector('button[aria-haspopup="listbox"]')!)
  fireEvent.click((await screen.findByRole('option',{name:'有効'})).querySelector('button')!)
  expect(active).toHaveBeenCalledWith(true)
  expect(all).not.toHaveBeenCalled()
})
