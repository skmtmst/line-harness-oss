// @vitest-environment happy-dom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { afterEach,expect,it,vi } from 'vitest'
import { useState } from 'react'
import { INITIAL_MENUS, initialMenuImageDataUri } from '@line-crm/shared'
import { InitialMenuChoice, type InitialMenuSelection } from './initial-menu-choice'
const net=vi.hoisted(()=>({resources:vi.fn()}))
vi.mock('@/lib/api/helpers/styles',()=>({styleApi:net}))
afterEach(()=>{cleanup();vi.resetAllMocks()})
function Choice(){const [value,setValue]=useState<InitialMenuSelection>({value:'simple'});return <InitialMenuChoice accountId="a" style="restaurant" value={value} onChange={setValue}/>}
it('4面のラベルと実PNGを示し、既存を選ぶ時はメニュー全体だけ選べる',async()=>{
 net.resources.mockResolvedValue({success:true,data:{items:[{id:'whole',name:'店で作ったメニュー',kind:'rich_menu'},{id:'image',name:'画像だけ',kind:'image'}]}})
 render(<Choice/>);
 expect(screen.getByRole('img').getAttribute('src')).toBe(initialMenuImageDataUri('restaurant'))
 for(const button of INITIAL_MENUS.restaurant.buttons)expect(screen.getByRole('cell',{name:button.label})).toBeTruthy()
 fireEvent.click(screen.getByRole('radio',{name:/今あるメニュー/}));
 await waitFor(()=>expect(net.resources).toHaveBeenCalledWith('a'))
 expect(screen.queryByRole('img')).toBeNull()
 await waitFor(()=>expect((screen.getByRole('button',{name:'使うリッチメニュー'}) as HTMLButtonElement).disabled).toBe(false))
 expect(screen.queryByText('画像だけ')).toBeNull()
 fireEvent.click(screen.getByRole('radio',{name:/あとで設定/}));expect(screen.queryByRole('button',{name:'使うリッチメニュー'})).toBeNull()
})
it('閲覧だけならメニューの選び方を変えられない',()=>{
 const onChange=vi.fn();render(<InitialMenuChoice accountId="a" style="ec" value={{value:'simple'}} onChange={onChange} disabled/>);
 fireEvent.click(screen.getByRole('radio',{name:/あとで設定/}));expect(onChange).not.toHaveBeenCalled()
 expect(screen.queryByText('予約用の回答フォーム')).toBeNull()
})
