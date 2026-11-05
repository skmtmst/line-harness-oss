import {floorBoxCorners,floorBoxesOverlap,type RestaurantFloor} from '@line-crm/shared'

export type PlannedTable={x:number;y:number;width:number;height:number;rotation:0}
export type FloorPlacement={width:number;height:number;tables:PlannedTable[]}

/** 既存の卓を動かさず、椅子と卓名の余白を含む格子に新しい卓を置く。 */
export function planFloorTables(floor:RestaurantFloor,count:number,tableWidth:number,tableHeight:number):FloorPlacement|null {
 if(!Number.isInteger(count)||count<1||count>200||tableWidth<=0||tableHeight<=0)return null
 const gapX=40,gapY=58,margin=30
 const stepX=tableWidth+gapX,stepY=tableHeight+gapY
 const existing=floor.tables
 const fixtures=floor.fixtures.filter(f=>f.kind!=='window')
 if(!fixtures.some(f=>f.kind==='entrance'))fixtures.push({id:'map-entrance',kind:'entrance',x:16,y:16,width:84,height:32})
 const existingPoints=[...floor.tables,...fixtures].flatMap(floorBoxCorners)
 const right=Math.max(floor.width,...existingPoints.map(p=>p.x+margin))
 const bottom=Math.max(floor.height,...existingPoints.map(p=>p.y+margin))
 const preferredColumns=Math.max(1,Math.ceil(Math.sqrt(count*stepY/stepX)))
 const columns=Math.min(count,preferredColumns)
 const width=Math.max(right,margin*2+columns*stepX)
 if(width>10000)return null
 const planned:PlannedTable[]=[]
 const blocked=(candidate:PlannedTable)=>{
  const padded={...candidate,x:candidate.x-12,y:candidate.y-12,width:candidate.width+24,height:candidate.height+24}
  return existing.some(t=>floorBoxesOverlap(padded,t))||fixtures.some(f=>floorBoxesOverlap(padded,f))||planned.some(t=>floorBoxesOverlap(padded,t))
 }
 for(let row=0;row<200&&planned.length<count;row++)for(let column=0;column<columns&&planned.length<count;column++){
  const candidate:PlannedTable={x:margin+column*stepX,y:margin+row*stepY,width:tableWidth,height:tableHeight,rotation:0}
  if(candidate.y+tableHeight+margin>10000)return null
  if(!blocked(candidate))planned.push(candidate)
 }
 if(planned.length!==count)return null
 const height=Math.max(bottom,...planned.map(t=>t.y+t.height+margin))
 return {width,height,tables:planned}
}
