// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import RestaurantFloorEditor from './restaurant-floor-editor'
import {floorTableViewBox} from './restaurant-floor-map'
const api=vi.hoisted(()=>({floors:vi.fn(),saveFloor:vi.fn(),createFloor:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}))
vi.mock('@/lib/api/helpers/reservation-board',()=>({reservationBoardApi:api}))
const floor={id:'f',storeId:'s',name:'1階',width:500,height:300,version:7,outline:[],fixtures:[],tables:[{id:'t',x:50,y:50,width:80,height:60,rotation:0,shape:'rectangle' as const}]}
const props={accountId:'a',storeId:'s',resources:[{id:'t',label:'T1',active:true,capacity:2}],onSelect:vi.fn(),canEdit:true}
afterEach(()=>{cleanup();vi.resetAllMocks()})
it('＋／−は表示倍率だけを変え、配置は保存しない',async()=>{
 api.floors.mockResolvedValue({data:[floor]});render(<RestaurantFloorEditor {...props}/>)
 const map=await screen.findByRole('group',{name:'1階の座席表'})
 expect(map.getAttribute('viewBox')).toBe('0 0 500 300')
 fireEvent.click(screen.getByRole('button',{name:'拡大'}))
 expect(map.getAttribute('viewBox')).toBe('0 0 454.54545454545456 272.72727272727275')
 fireEvent.click(screen.getByRole('button',{name:'縮小'}))
 expect(map.getAttribute('viewBox')).toBe('0 0 500 300')
 expect(api.saveFloor).not.toHaveBeenCalled()
})
it('古い卓合わせ・全体表示・外形描画・つまんで置くを出さない',async()=>{
 api.floors.mockResolvedValue({data:[floor]});render(<RestaurantFloorEditor {...props}/>)
 await screen.findByRole('group',{name:'1階の座席表'})
 for(const name of ['卓に合わせて表示','全体を表示','外形を線で描く','つまんで置く'])expect(screen.queryByRole('button',{name})).toBeNull()
})
it('回転した卓の表示範囲の計算は維持する',()=>{
 const [x,y,w,h]=floorTableViewBox({...floor,tables:[{...floor.tables[0],rotation:90}]}).split(' ').map(Number)
 expect(x).toBeLessThanOrEqual(60);expect(y).toBeLessThanOrEqual(40)
 expect(x+w).toBeGreaterThanOrEqual(120);expect(y+h).toBeGreaterThanOrEqual(120)
})
