// @vitest-environment happy-dom
import React from 'react'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import StoreFilterTabs from './store-filter-tabs'
afterEach(cleanup)
it('店舗は共通タブで選び、現在の店舗と利用できない店舗は変更を呼ばない',()=>{
 const change=vi.fn();const {container}=render(<StoreFilterTabs value="a" onChange={change} options={[{value:'a',label:'店舗：渋谷'},{value:'b',label:'店舗：恵比寿'},{value:'c',label:'店舗：新宿',disabled:true}]}/> )
 expect(screen.queryByRole('combobox')).toBeNull();expect(screen.getByRole('tablist',{name:'店舗で絞り込む'})).toBeTruthy()
 fireEvent.click(screen.getByRole('tab',{name:'渋谷'}));fireEvent.click(screen.getByRole('tab',{name:'新宿'}));expect(change).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('tab',{name:'恵比寿'}));expect(change).toHaveBeenCalledWith('b');expect(container.querySelector('[data-wrap="true"]')).toBeTruthy()
})
it('選べない店舗の理由を出し、有効な店舗へ理由を持ち越さない',()=>{
 const change=vi.fn();render(<StoreFilterTabs value="a" onChange={change} options={[{value:'a',label:'渋谷'},{value:'b',label:'新宿',disabled:true,disabledReason:'LINE公式アカウントに未接続です'}]}/> )
 const unavailable=screen.getByRole('tab',{name:'新宿'});expect(unavailable.title).toBe('LINE公式アカウントに未接続です');expect(document.getElementById(unavailable.getAttribute('aria-describedby')!)?.textContent).toBe('LINE公式アカウントに未接続です');fireEvent.click(unavailable);expect(change).not.toHaveBeenCalled();expect(screen.getByRole('tab',{name:'渋谷'}).getAttribute('aria-describedby')).toBeNull()
})
it('読込み中の理由を個別の理由より先に出す',()=>{
 render(<StoreFilterTabs value="a" onChange={()=>{}} disabled disabledReason="店舗を読み込んでいます" options={[{value:'a',label:'渋谷',disabled:true,disabledReason:'未接続です'}]}/> )
 expect(screen.getByRole('tab',{name:'渋谷'}).title).toBe('店舗を読み込んでいます')
})
