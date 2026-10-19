// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), createTable: vi.fn(), updateTable: vi.fn(), saveTableLayout: vi.fn() }))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))

import TablesV8 from '@/v8/restaurant/tables/tables'
const floorApi=vi.hoisted(()=>({floors:vi.fn(),saveFloor:vi.fn(),createFloor:vi.fn()}))
vi.mock('@/lib/api/helpers/reservation-board',()=>({reservationBoardApi:floorApi}))
vi.mock('next/navigation',async()=> (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome',async()=> (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/lib/staff-role',()=>({useStaffRole:()=> 'owner',canManageRole:()=>true}))

const store = { id: 'store-1', organization_id: 'org-1', name: '渋谷店', code: 'SHIBUYA', area: null, capacity: 26, timezone: 'Asia/Tokyo', status: 'active', line_status: 'connected', google_status: 'unconfigured', line_account_id: 'account-1', line_account_name: '渋谷' }
const data = {
  organization: { id: 'org-1', account_id: 'account-1', tenant_id: null, tenant_name: null, name: 'テスト組織', status: 'active' },
  stores: [store],
  memberships: [],
  tables: [
    { id: 't1', store_id: 'store-1', code: 'T1', label: '2人卓', seat_type: 'table', min_capacity: 1, max_capacity: 2, floor_x: 0, floor_y: 0, join_group: null, is_active: 1 },
    { id: 't2', store_id: 'store-1', code: 'T2', label: '2人卓', seat_type: 'table', min_capacity: 1, max_capacity: 2, floor_x: 1, floor_y: 0, join_group: 'A', is_active: 1 },
    { id: 't3', store_id: 'store-1', code: 'T3', label: '窓側4人卓', seat_type: 'table', min_capacity: 2, max_capacity: 4, floor_x: 2, floor_y: 0, join_group: 'A', is_active: 1 },
    { id: 'pb', store_id: 'store-1', code: '個室B', label: '個室', seat_type: 'private_room', min_capacity: 4, max_capacity: 8, floor_x: 0, floor_y: 1, join_group: null, is_active: 0 },
  ],
  menuItems: [],
  reservations: [], reservationTotal: 0, inventory: [], approvals: [], connectors: [], reviews: [], posts: [], lineFlows: [],
}

const floor={id:'floor-1',storeId:'store-1',name:'1階',width:600,height:400,version:1,outline:[],fixtures:[],tables:data.tables.map((t,i)=>({id:t.id,x:50+i*120,y:50,width:80,height:60,rotation:0,shape:'rectangle',joinGroup:t.join_group}))}
function dragTable(table:HTMLElement) {
 const svg=table.closest('svg')!
 Object.defineProperty(svg,'getScreenCTM',{value:()=>({inverse:()=>({})}),configurable:true})
 Object.defineProperty(table,'setPointerCapture',{value:()=>{},configurable:true})
 vi.stubGlobal('DOMPoint',class {constructor(public x:number,public y:number){} matrixTransform(){return {x:this.x,y:this.y}}})
 fireEvent.pointerDown(table,{clientX:50,clientY:50,pointerId:1})
 fireEvent.pointerMove(svg,{clientX:60,clientY:50,pointerId:1})
 fireEvent.pointerUp(svg,{pointerId:1})
}

beforeEach(() => {
  floorApi.floors.mockResolvedValue({data:[floor]});floorApi.saveFloor.mockResolvedValue({success:true});
  fixture.snapshot.mockResolvedValue({ data })
  fixture.createTable.mockResolvedValue({ success: true })
  fixture.saveTableLayout.mockResolvedValue({success:true})
  fixture.updateTable.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

/*
 * ★V8-B 座席・卓管理（板 `BERxg`）の契約。
 * 数4・マップ（選ぶと結合札）・詳細（変更・停止／再開）・配席ルールが
 * 板どおりに出て、操作が今の口へ届くことを固定する。
 */
describe('BERxg 座席・卓管理のV8', () => {
  it('数4とマップ・詳細・ルールが出る', async () => {
    render(<TablesV8 />)
    await screen.findByRole('group',{name:'1階の座席表'})
    const board = document.querySelector('[data-design-node="BERxg"]')!
    expect(board.textContent).toContain('卓数')
    expect(board.textContent).toContain('総席数')
    expect(board.textContent).toContain('結合可能')
    expect(board.textContent).toContain('個室')
    expect(screen.getByRole('group',{name:'1階の座席表'})).toBeTruthy()
    expect(board.textContent).toContain('卓の詳細')
    expect(board.textContent).toContain('自動配席ルール')
  })

  it('マップの卓を選ぶと結合札が出る', async () => {
    render(<TablesV8 />)
    await screen.findByRole('group',{name:'1階の座席表'})
    expect(screen.getByRole('group',{name:'1階の座席表'}).querySelector('line')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'T2' }))
    const selected=screen.getByText('T2 · 2人卓').closest('li')!
    expect(selected.className).toContain('detailRowSelected')
  })

  it('卓の詳細から変更・停止・再開が今の口へ届く', async () => {
    render(<TablesV8 />)
    const detail = (await screen.findByRole('heading', { name: '卓の詳細' })).closest('section')!
    fireEvent.click(within(detail).getAllByRole('button', { name: /のその他操作$/ })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: '変更' }))
    fireEvent.change(screen.getByDisplayValue('2人卓'), { target: { value: '奥の2人卓' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(fixture.updateTable).toHaveBeenCalledWith('account-1', 't1', expect.objectContaining({ label: '奥の2人卓' })))
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect((within(detail).getAllByRole('button', { name: /のその他操作$/ })[0] as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(detail).getAllByRole('button', { name: /のその他操作$/ })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: '停止' }))
    fireEvent.click(screen.getByRole('button', { name: '止める' }))
    await waitFor(() => expect(fixture.updateTable).toHaveBeenCalledWith('account-1', 't1', expect.objectContaining({ isActive: false })))
    await waitFor(() => expect((within(detail).getByRole('button', { name: '個室B・個室のその他操作' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(detail).getByRole('button', { name: '個室B・個室のその他操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '再開' }))
    await waitFor(() => expect(fixture.updateTable).toHaveBeenCalledWith('account-1', 'pb', expect.objectContaining({ isActive: true })))
  })

  it('追加・変更の枠に板 gBrCz の印が付く', async () => {
    render(<TablesV8 />)
    const detail = (await screen.findByRole('heading', { name: '卓の詳細' })).closest('section')!
    fireEvent.click(within(detail).getAllByRole('button', { name: /のその他操作$/ })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: '変更' }))
    expect(document.querySelector('[data-design-node="gBrCz"]')).not.toBeNull()
  })

  it('止める確認に板 eY9F3 の印が付く', async () => {
    render(<TablesV8 />)
    const detail = (await screen.findByRole('heading', { name: '卓の詳細' })).closest('section')!
    fireEvent.click(within(detail).getAllByRole('button', { name: /のその他操作$/ })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: '停止' }))
    expect(document.querySelector('[data-design-node="eY9F3"]')).not.toBeNull()
  })
})

it('座標と結合グループを数値入力で保存する',async()=>{
 render(<TablesV8 />)
 const detail=(await screen.findByRole('heading',{name:'卓の詳細'})).closest('section')!
 fireEvent.click(within(detail).getAllByRole('button',{name:/のその他操作$/})[0])
 fireEvent.click(screen.getByRole('menuitem',{name:'変更'}))
 fireEvent.click(screen.getByRole('button',{name:'配置・結合グループ'}))
 fireEvent.change(screen.getByRole('spinbutton',{name:'横の位置'}),{target:{value:'2'}})
 fireEvent.change(screen.getByRole('spinbutton',{name:'縦の位置'}),{target:{value:'1'}})
 fireEvent.change(screen.getByRole('textbox',{name:'結合グループ'}),{target:{value:'B'}})
 fireEvent.click(screen.getByRole('button',{name:'保存する'}))
 await waitFor(()=>expect(fixture.updateTable).toHaveBeenCalledWith('account-1','t1',expect.objectContaining({floorX:2,floorY:1,joinGroup:'B'})))
})
it('ドラッグした配置をまとめて保存し、再取得した座標で表示する',async()=>{
 const saved={...floor,version:2,tables:floor.tables.map(t=>t.id==='t1'?{...t,x:60}:t)}
 floorApi.saveFloor.mockImplementation(async()=>{floorApi.floors.mockResolvedValue({data:[saved]});return {success:true}})
 const view=render(<TablesV8 />);dragTable(await screen.findByRole('button',{name:'T1'}))
 fireEvent.click(screen.getByRole('button',{name:'座席図を保存'}))
 await waitFor(()=>expect(floorApi.saveFloor).toHaveBeenCalledWith('account-1',expect.objectContaining({storeId:'store-1',expectedVersion:1,tables:[expect.objectContaining({id:'t1',x:60}),...floor.tables.slice(1)]})))
 await waitFor(()=>expect(screen.queryByRole('button',{name:'座席図を保存'})).toBeNull())
 view.unmount();render(<TablesV8 />)
 expect((await screen.findByRole('button',{name:'T1'})).getAttribute('transform')).toContain('translate(60 50)')
})
it('配置の保存が失敗したら失敗を表示し、入力を保ち保存済みの配置は変えない',async()=>{
 floorApi.saveFloor.mockRejectedValue(new Error('409'))
 const view=render(<TablesV8 />);dragTable(await screen.findByRole('button',{name:'T1'}))
 fireEvent.click(screen.getByRole('button',{name:'座席図を保存'}))
 await screen.findByText(/保存できませんでした/)
 expect(screen.getByRole('button',{name:'T1'}).getAttribute('transform')).toContain('translate(60 50)')
 expect(screen.getByRole('button',{name:'座席図を保存'})).toBeTruthy()
 view.unmount();render(<TablesV8 />)
 expect((await screen.findByRole('button',{name:'T1'})).getAttribute('transform')).toContain('translate(50 50)')
})
