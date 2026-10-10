'use client'
import {useRef,type PointerEvent} from 'react'
import {floorBoxInside,floorBoxesOverlap,type RestaurantFloor,type ReservationBoardResource} from '@line-crm/shared'
import styles from './restaurant-floor-map.module.css'
type Box={x:number;y:number;width:number;height:number}

/** 店の保存した寸法で描き、図面の編集と予約盤の読み取りで共用する。 */
export default function RestaurantFloorMap({floor,labels,onSelect,onChange,onFloorChange,canEdit=false,drawing=false}:{floor:RestaurantFloor;labels:ReservationBoardResource[];onSelect:(id:string)=>void;onChange?:(tables:RestaurantFloor['tables'])=>void;onFloorChange?:(floor:RestaurantFloor)=>void;canEdit?:boolean;drawing?:boolean}) {
 const svg=useRef<SVGSVGElement>(null),drag=useRef<{id:string;fixture:boolean;x:number;y:number;ox:number;oy:number}|null>(null)
 const point=(e:{clientX:number;clientY:number})=>{const matrix=svg.current!.getScreenCTM()!;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());return {x:Math.round(p.x/10)*10,y:Math.round(p.y/10)*10}}
 const move=(id:string,fixture:boolean,x:number,y:number)=>{
  const items=fixture?floor.fixtures:floor.tables,moving=items.find(t=>t.id===id);if(!moving)return
  const next={...moving,x:Math.min(floor.width-moving.width,Math.max(0,x)),y:Math.min(floor.height-moving.height,Math.max(0,y))}
  if(!floorBoxInside(next,floor.width,floor.height)||(!fixture&&floor.tables.some(t=>t.id!==id&&floorBoxesOverlap(next,t))))return
  if(fixture)onFloorChange?.({...floor,fixtures:floor.fixtures.map(t=>t.id===id?{...t,x:next.x,y:next.y}:t)})
  else onChange?.(floor.tables.map(t=>t.id===id?{...t,x:next.x,y:next.y}:t))
 }
 const start=(e:PointerEvent<SVGGElement>,id:string,fixture:boolean,t:Box)=>{if(!canEdit||drawing)return;const p=point(e);drag.current={id,fixture,...p,ox:t.x,oy:t.y};e.currentTarget.setPointerCapture(e.pointerId)}
 const groups=[...new Set(floor.tables.map(t=>t.joinGroup).filter(Boolean))]
 return <svg ref={svg} className={styles.map} viewBox={`0 0 ${floor.width} ${floor.height}`} role="group" aria-label={`${floor.name}の座席表`}
 onClick={e=>{if(canEdit&&drawing&&onFloorChange){const p=point(e);if(p.x>=0&&p.y>=0&&p.x<=floor.width&&p.y<=floor.height)onFloorChange({...floor,outline:[...floor.outline,p]})}}}
 onPointerMove={e=>{const d=drag.current;if(!d)return;const p=point(e);move(d.id,d.fixture,d.ox+p.x-d.x,d.oy+p.y-d.y)}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
 {floor.outline.length>2?<polygon className={styles.outline} points={floor.outline.map(p=>`${p.x},${p.y}`).join(' ')}/>:<rect className={styles.outline} x="1" y="1" width={floor.width-2} height={floor.height-2}/>}
 {drawing?<polyline className={styles.outline} points={floor.outline.map(p=>`${p.x},${p.y}`).join(' ')}/>:null}
 {floor.fixtures.map(f=><g key={f.id} role={canEdit?'button':undefined} tabIndex={canEdit?0:undefined} aria-label={f.kind} onClick={()=>{if(!drawing)onSelect('fixture:'+f.id)}} onPointerDown={e=>start(e,f.id,true,f)} onKeyDown={e=>{if(canEdit&&e.key.startsWith('Arrow')){e.preventDefault();move(f.id,true,f.x+(e.key==='ArrowLeft'?-10:e.key==='ArrowRight'?10:0),f.y+(e.key==='ArrowUp'?-10:e.key==='ArrowDown'?10:0))}}}><rect className={styles.fixture} x={f.x} y={f.y} width={f.width} height={f.height}/><text x={f.x+f.width/2} y={f.y+f.height/2}>{({wall:'壁',entrance:'入口',kitchen:'厨房',toilet:'トイレ',window:'窓'}[f.kind])}</text></g>)}
 {groups.flatMap(group=>{const ts=floor.tables.filter(t=>t.joinGroup===group);return ts.slice(1).map(t=><line key={group+'-'+t.id} className={styles.join} x1={ts[0].x+ts[0].width/2} y1={ts[0].y+ts[0].height/2} x2={t.x+t.width/2} y2={t.y+t.height/2}/>)})}
 {floor.tables.map(t=>{const r=labels.find(l=>l.id===t.id);return <g key={t.id} className={r?.active===false?styles.stopped:styles.table} transform={`translate(${t.x} ${t.y}) rotate(${t.rotation} ${t.width/2} ${t.height/2})`} role="button" tabIndex={0} aria-label={`${r?.label??t.id}${r?.active===false?' 停止中':''}`} onClick={()=>{if(!drawing)onSelect(t.id)}} onPointerDown={e=>start(e,t.id,false,t)} onKeyDown={e=>{
 if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(t.id)}
 if(canEdit&&e.key.startsWith('Arrow')){e.preventDefault();move(t.id,false,t.x+(e.key==='ArrowLeft'?-10:e.key==='ArrowRight'?10:0),t.y+(e.key==='ArrowUp'?-10:e.key==='ArrowDown'?10:0))}
 }}>
 {t.shape==='circle'?<ellipse cx={t.width/2} cy={t.height/2} rx={t.width/2} ry={t.height/2}/>:<rect width={t.width} height={t.height} rx={t.shape==='counter'?t.height/2:8}/>}
 <text x={t.width/2} y={t.height/2}>{r?.label??t.id}</text><text x={t.width/2} y={t.height/2+18}>{r?`${r.capacity}人卓`:'—'}</text>
 </g>})}</svg>
}
