import {expect,it} from 'vitest'
import {floorBoxesOverlap,type RestaurantFloor} from '@line-crm/shared'
import {planFloorTables} from './restaurant-floor-placement'

const floor={id:'floor',storeId:'store',name:'1階',width:1000,height:700,version:1,outline:[],fixtures:[],tables:[]} as RestaurantFloor
for(const [count,capacity,width,height] of [[25,4,80,64],[50,2,80,64],[100,1,64,80]] as const){
 it(`${count}卓・${capacity}名で既存の卓を動かさず配置する`,()=>{
  const first={id:'existing',x:30,y:30,width,height,rotation:0,shape:'rectangle' as const}
  const plan=planFloorTables({...floor,tables:[first]},count,width,height)
  expect(plan?.tables).toHaveLength(count)
  expect(plan!.width).toBeLessThanOrEqual(10000)
  expect(plan!.height).toBeLessThanOrEqual(10000)
  for(const [index,t] of plan!.tables.entries()){
   expect(t.x).toBeGreaterThanOrEqual(0)
   expect(t.y).toBeGreaterThanOrEqual(0)
   expect(t.x+t.width).toBeLessThanOrEqual(plan!.width)
   expect(t.y+t.height).toBeLessThanOrEqual(plan!.height)
   expect(floorBoxesOverlap(t,first)).toBe(false)
   expect(floorBoxesOverlap(t,{x:16,y:16,width:84,height:32})).toBe(false)
   for(const other of plan!.tables.slice(index+1))expect(floorBoxesOverlap(t,other)).toBe(false)
  }
 })
}
it('入口と設備を空け、100卓でも既存の卓を動かさない',()=>{
 const entrance={id:'entrance',kind:'entrance' as const,x:30,y:30,width:80,height:40}
 const kitchen={id:'kitchen',kind:'kitchen' as const,x:150,y:30,width:180,height:100}
 const plan=planFloorTables({...floor,fixtures:[entrance,kitchen]},100,80,64)
 expect(plan?.tables).toHaveLength(100)
 for(const table of plan!.tables){
  expect(floorBoxesOverlap(table,entrance)).toBe(false)
  expect(floorBoxesOverlap(table,kitchen)).toBe(false)
 }
})
