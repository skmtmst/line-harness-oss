// @vitest-environment happy-dom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import RestaurantFloorEditor from './restaurant-floor-editor'
const api=vi.hoisted(()=>({floors:vi.fn(),saveFloor:vi.fn(),createFloor:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}))
vi.mock('@/lib/api/helpers/reservation-board',()=>({reservationBoardApi:api}))
const table={id:'t',x:50,y:50,width:80,height:60,rotation:0,shape:'rectangle' as const}
const floor={id:'f',storeId:'s',name:'1階',width:500,height:300,version:7,outline:[],fixtures:[],tables:[table]}
const resource={id:'t',label:'T1',active:true,capacity:2}
const props={accountId:'a',storeId:'s',resources:[resource],onSelect:vi.fn(),canEdit:true}
beforeEach(()=>{api.floors.mockReset().mockResolvedValue({data:[floor]});api.saveFloor.mockReset().mockResolvedValue({})})
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('追加された卓を読み直す間も座席図を残し、新しい卓を図へ反映する',async()=>{
 const view=render(<RestaurantFloorEditor {...props}/>);await screen.findByRole('button',{name:'T1'})
 let reply!:(r:unknown)=>void;api.floors.mockImplementationOnce(()=>new Promise(r=>{reply=r}))
 view.rerender(<RestaurantFloorEditor {...props} resources={[resource,{...resource,id:'t2',label:'T2'}]}/>)
 await waitFor(()=>expect(api.floors).toHaveBeenCalledTimes(2))
 expect(screen.getByRole('button',{name:'T1'})).toBeTruthy()
 expect(screen.getByRole('status').textContent).toContain('読み込み中')
 expect(screen.getByRole('button',{name:'配置パターンから追加'}).hasAttribute('disabled')).toBe(true)
 await act(async()=>reply({data:[{...floor,version:8,tables:[table,{...table,id:'t2',x:150}]}]}))
 expect(await screen.findByRole('button',{name:'T2'})).toBeTruthy()
 expect(screen.queryByRole('status')).toBeNull()
 expect(screen.getByRole('button',{name:'配置パターンから追加'}).hasAttribute('disabled')).toBe(false)
})
it('卓の追加が届いても未保存の配置と期待版を上書きしない',async()=>{
 const view=render(<RestaurantFloorEditor {...props}/>);const t=await screen.findByRole('button',{name:'T1'})
 fireEvent.keyDown(t,{key:'ArrowRight'})
 view.rerender(<RestaurantFloorEditor {...props} resources={[resource,{...resource,id:'t2',label:'T2'}]}/>)
 expect(t.getAttribute('transform')).toContain('translate(60 50)')
 expect(api.floors).toHaveBeenCalledTimes(1)
 expect(await screen.findByText(/卓の情報が変わりました/)).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'座席図を保存'}))
 await waitFor(()=>expect(api.saveFloor).toHaveBeenCalledWith('a',expect.objectContaining({expectedVersion:7,tables:[expect.objectContaining({x:60})]})))
})

it('再取得中にもう1卓追加されても、古い応答で再取得の必要を消さない',async()=>{
 const view=render(<RestaurantFloorEditor {...props}/>);await screen.findByRole('button',{name:'T1'})
 let reply!:(r:unknown)=>void
 api.floors.mockImplementationOnce(()=>new Promise(r=>{reply=r})).mockResolvedValueOnce({data:[{...floor,version:9,tables:[table,{...table,id:'t2',x:150},{...table,id:'t3',x:250}]}]})
 const added=[resource,{...resource,id:'t2',label:'T2'}]
 view.rerender(<RestaurantFloorEditor {...props} resources={added}/>)
 await waitFor(()=>expect(api.floors).toHaveBeenCalledTimes(2))
 view.rerender(<RestaurantFloorEditor {...props} resources={[...added,{...resource,id:'t3',label:'T3'}]}/>)
 await act(async()=>reply({data:[{...floor,version:8,tables:[table,{...table,id:'t2',x:150}]}]}))
 expect(await screen.findByRole('button',{name:'T3'})).toBeTruthy()
 expect(api.floors).toHaveBeenCalledTimes(3)
})
