// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,createEvent,fireEvent,render,screen} from '@testing-library/react'
import RestaurantFloorEditor from './restaurant-floor-editor'
import {floorTableViewBox} from './restaurant-floor-map'
const api=vi.hoisted(()=>({floors:vi.fn(),saveFloor:vi.fn(),createFloor:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}))
vi.mock('@/lib/api/helpers/reservation-board',()=>({reservationBoardApi:api}))
const floor={id:'f',storeId:'s',name:'1階',width:500,height:300,version:7,outline:[],fixtures:[],tables:[{id:'t',x:50,y:50,width:80,height:60,rotation:0,shape:'rectangle' as const}]}
const props={accountId:'a',storeId:'s',resources:[{id:'t',label:'T1',active:true,capacity:2}],onSelect:vi.fn(),canEdit:true}
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals()})
it('縮尺は表示だけを変え、全体へ戻せる。配置を保存しない',async()=>{
 api.floors.mockResolvedValue({data:[floor]});render(<RestaurantFloorEditor {...props}/>)
 const map=await screen.findByRole('group',{name:'1階の座席表'})
 fireEvent.click(screen.getByRole('button',{name:'卓に合わせて表示'}))
 expect(map.getAttribute('viewBox')).toBe('26 26 160 120')
 expect(screen.queryByRole('button',{name:'座席図を保存'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'全体を表示'}))
 expect(map.getAttribute('viewBox')).toBe('0 0 500 300');expect(api.saveFloor).not.toHaveBeenCalled()
})
it('90度回転した卓の四隅も表示の範囲へ入れる',()=>{
 const [x,y,w,h]=floorTableViewBox({...floor,tables:[{...floor.tables[0],rotation:90}]}).split(' ').map(Number)
 expect(x).toBeLessThanOrEqual(60);expect(y).toBeLessThanOrEqual(40)
 expect(x+w).toBeGreaterThanOrEqual(120);expect(y+h).toBeGreaterThanOrEqual(120)
 expect(floorTableViewBox({...floor,tables:[]})).toBe('0 0 500 300')
})
it('拡大表示中のドラッグは画面座標を逆変換し、保存座標を10だけ動かす',async()=>{
 api.floors.mockResolvedValue({data:[floor]});api.saveFloor.mockResolvedValue({})
 vi.stubGlobal('DOMPoint',class {constructor(public x:number,public y:number){} matrixTransform(m:{a:number;d:number;e:number;f:number}){return{x:this.x*m.a+m.e,y:this.y*m.d+m.f}}})
 render(<RestaurantFloorEditor {...props}/>)
 const table=await screen.findByRole('button',{name:'T1'}),map=screen.getByRole('group',{name:'1階の座席表'})
 Object.defineProperty(map,'getScreenCTM',{value:()=>({inverse:()=>({a:1/3,d:1/3,e:26,f:26})})})
 Object.defineProperty(table,'setPointerCapture',{value:vi.fn()})
 fireEvent.click(screen.getByRole('button',{name:'卓に合わせて表示'}))
 const pointer=(type:'pointerDown'|'pointerMove',target:Element,x:number)=>{const event=createEvent[type](target);Object.defineProperties(event,{clientX:{value:x},clientY:{value:72},pointerId:{value:1}});fireEvent(target,event)}
 pointer('pointerDown',table,72);pointer('pointerMove',map,102);fireEvent.pointerUp(map)
 expect(map.getAttribute('viewBox')).toBe('26 26 160 120')
 expect(table.getAttribute('transform')).toContain('translate(60 50)')
 fireEvent.click(screen.getByRole('button',{name:'座席図を保存'}))
 expect(api.saveFloor).toHaveBeenCalledWith('a',expect.objectContaining({expectedVersion:7,tables:[expect.objectContaining({x:60,y:50})]}))
})
