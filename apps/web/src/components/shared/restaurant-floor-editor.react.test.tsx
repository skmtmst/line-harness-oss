// @vitest-environment happy-dom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import RestaurantFloorEditor from './restaurant-floor-editor'
const api=vi.hoisted(()=>({floors:vi.fn(),saveFloor:vi.fn(),createFloor:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}))
vi.mock('@/lib/api-reservation-board',()=>({reservationBoardApi:api}))
const floor={id:'f',storeId:'s',name:'1階',width:500,height:300,version:7,outline:[],fixtures:[],tables:[{id:'t',x:50,y:50,width:80,height:60,rotation:0,shape:'rectangle'}]}
const props={accountId:'a',storeId:'s',resources:[{id:'t',label:'T1',active:true,capacity:2}],onSelect:vi.fn()}
beforeEach(()=>{api.floors.mockResolvedValue({data:[floor]});api.saveFloor.mockRejectedValue(new Error('409'));api.createFloor.mockReset()})
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('競合の保存失敗でも配置を残し、取得した版で保存する',async()=>{
 render(<RestaurantFloorEditor {...props} canEdit/>)
 const table=await screen.findByRole('button',{name:'T1'});fireEvent.keyDown(table,{key:'ArrowRight'});
 fireEvent.click(screen.getByRole('button',{name:'座席図を保存'}));await screen.findByText(/入力を控えて/)
 expect(api.saveFloor).toHaveBeenCalledWith('a',expect.objectContaining({expectedVersion:7,tables:[expect.objectContaining({x:60})]}))
 expect(table.getAttribute('transform')).toContain('translate(60 50)');expect(screen.getByRole('button',{name:'座席図を保存'})).toBeTruthy()
})
it('閲覧のみには配置・保存・階の追加を出さず、卓の読み取りは残す',async()=>{
 render(<RestaurantFloorEditor {...props} canEdit={false}/>);const table=await screen.findByRole('button',{name:'T1'});
 fireEvent.keyDown(table,{key:'ArrowRight'});expect(table.getAttribute('transform')).toContain('translate(50 50)')
 expect(screen.queryByRole('button',{name:'座席図を保存'})).toBeNull();expect(screen.queryByRole('button',{name:'外形を線で描く'})).toBeNull();expect(api.saveFloor).not.toHaveBeenCalled()
})
it('店を切り替えた後に古い座席図が届いても、新しい店へ上書きしない',async()=>{
 let old!:(value:unknown)=>void;api.floors.mockImplementation((_a:string,s:string)=>s==='s'?new Promise(r=>{old=r}):Promise.resolve({data:[{...floor,id:'f2',storeId:'s2',name:'別店'}]}))
 const view=render(<RestaurantFloorEditor {...props} canEdit/>);view.rerender(<RestaurantFloorEditor {...props} storeId="s2" canEdit/>);await screen.findByRole('group',{name:'別店の座席表'})
 old({data:[floor]});await waitFor(()=>expect(screen.queryByRole('group',{name:'1階の座席表'})).toBeNull());expect(screen.getByRole('group',{name:'別店の座席表'})).toBeTruthy()
})
