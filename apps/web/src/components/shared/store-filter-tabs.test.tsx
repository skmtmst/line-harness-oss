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
