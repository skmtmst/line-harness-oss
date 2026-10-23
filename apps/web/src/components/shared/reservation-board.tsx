'use client'

import { jstCalendar as japanCalendar } from '@/lib/jst-datetime'
import { jstDate as japanDate } from '@/lib/jst-datetime'

import { jstDate } from '@/lib/jst-datetime'
import {useEffect,useMemo,useRef,useState,type ReactNode,type DragEvent} from 'react'
import {Printer} from 'lucide-react'
import {createPortal} from 'react-dom'
import {reservationOccupies} from '@line-crm/shared'
import type {ReservationAxis,ReservationBoardEntry,ReservationBoardMove,ReservationBoardResource,RestaurantFloor} from '@line-crm/shared'
import IconButton from './icon-button'
import ActionMenu from './action-menu'
import Button from './button'
import Card from './card'
import TruncatedText from './truncated-text'
import SegmentedControl from './segmented'
import Notice from './notice'
import {BookingBlock,BookingSlot} from './booking-controls'
import {BookingLegend,BookingLegendItem,BookingStatus,BookingName,ReservationSource,BookingNowLine,BookingGap,BookingSummary} from './booking-presentation'
import {reservationBookingState,reservationGapMinutes} from './booking-state'
export {ReservationSource} from './booking-presentation'
import {DataTable,TableHeadRow,Th,Td,Tr,RowNameButton} from './table'
import StatusBadge from './status-badge'
import {formatDate} from '@/lib/format'
import RestaurantFloorMap from './restaurant-floor-map'
import ReservationMonth from './reservation-month'
import CalendarPeriod from './calendar-period'
import ReservationPeopleGrid from './reservation-people-grid'
import styles from './reservation-board.module.css'
const hm=(iso:string)=>formatDate(iso,{style:'time'})
const civil=(iso:string)=>japanCalendar(new Date(Date.parse(iso)))
const dayKey=(iso:string)=>japanDate(new Date(iso))
const minutes=(iso:string)=>civil(iso).getUTCHours()*60+civil(iso).getUTCMinutes()
const state=(s:string)=>({confirmed:'予約あり',requested:'承認待ち',pending:'承認待ち',visited:'来店中',seated:'着席中',completed:'完了',late:'遅れ',expiring:'期限間近',cancelled:'取消',no_show:'無断取消'}[s]??s)
const axisName={resource:'時間',floor:'座席表',list:'一覧',month:'月'}
export function ReservationDetailsActions({children}:{children:ReactNode}){return <div className={styles.detailActions}>{children}</div>}
/** 既存の凡例の入口も状態だけを表す。 */
export function ReservationLegend({items,label='予約の状態'}:{items:Array<{label:string;tone:'info'|'warning'|'success'|'neutral'|'danger'}>;label?:string}){return <span className={styles.legendInline} role="list" aria-label={label}>{items.map(item=><span key={item.label} role="listitem"><BookingLegendItem state={item.tone==='success'?'active':item.tone==='warning'?'pending':item.tone==='danger'?'attention':item.tone==='neutral'?'completed':'confirmed'}>{item.label}</BookingLegendItem></span>)}</span>}
export function ReservationFacts({items}:{items:Array<{label:string;value:ReactNode}>}){return <dl className={styles.facts}>{items.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
export function ReservationDining({entry,dense=false}:{entry:ReservationBoardEntry;dense?:boolean}) {
 if(dense)return <div className={styles.denseDining}><strong>飲食（顧客情報と同じ段）</strong><ReservationFacts items={[{label:'アレルギー',value:entry.dining?.allergy||entry.currentAllergy?<StatusBadge size="dining" tone="info" surface="white">{entry.dining?.allergy||entry.currentAllergy}</StatusBadge>:'—'},{label:'記念日',value:entry.dining?.anniversary||'—'},...(entry.dining?.seatPreference?[{label:'席の好み',value:entry.dining.seatPreference}]:[]),...(entry.dining?.courseAllergens?.length?[{label:'コースの注意',value:entry.dining.courseAllergens.join('・')}]:[]),...(entry.currentAllergy&&entry.dining?.allergy&&entry.currentAllergy!==entry.dining.allergy?[{label:'今回の注意',value:entry.currentAllergy}]:[])]}/></div>
 return <div className={styles.dining}><strong>飲食</strong><dl>
 <div><dt>今回の注意</dt><dd>{entry.currentAllergy??'—'}</dd></div>
 <div><dt>アレルギー</dt><dd>{entry.dining?.allergy??'—'}</dd></div>
 <div><dt>記念日</dt><dd>{entry.dining?.anniversary??'—'}</dd></div>
 <div><dt>席の好み</dt><dd>{entry.dining?.seatPreference??'—'}</dd></div>
 <div><dt>コースの注意</dt><dd>{entry.dining?.courseAllergens?.join('・')||'—'}</dd></div>
 </dl><p>予約時点の注意情報（店舗で確認してください）</p></div>
}
export type ReservationBoardSlot={resourceId:string;startsAt:string;href?:string}
/** 保存先による違いは表示型と変更契約に閉じ、すべての入口を同じ盤で描く。 */
export default function ReservationBoard({entries,resources,axis:controlledAxis='resource',onAxis,canWrite=false,busy=false,onOpen,onMove,actions,menus,toolbar,trailingToolbar,notice,floor,loadPrintEntries,printContext,title='予約台帳',compact=false,dates,slots,onSlot,kind:requestedKind,columns='standard',diningContentColumns=false,monthNamePresentation,timeDirection,renderBody,renderList,selectedId,breaks}: {
 breaks?:Record<string,ReadonlyArray<{weekday:number;start_time:string;end_time:string}>>;
 selectedId?:string;
 timeDirection?: 'vertical';
 renderBody?:(body:ReactNode)=>ReactNode;
 renderList?:()=>ReactNode;
 columns?:'standard'|'dining'|'today';
 /** 指定した飲食の一覧だけ、補助列を中身で測り名前へ残り幅を配る。 */
 diningContentColumns?:boolean;
 monthNamePresentation?:'readable';
 kind?:'people'|'seats';entries:ReservationBoardEntry[];resources:ReservationBoardResource[];axis?:ReservationAxis;onAxis?:(axis:ReservationAxis)=>void;
 canWrite?:boolean;busy?:boolean;onOpen:(id:string)=>void;onMove?:(id:string,move:ReservationBoardMove)=>Promise<void>;
  menus?:(entry:ReservationBoardEntry)=>ReactNode; actions?:(entry:ReservationBoardEntry)=>ReactNode;toolbar?:ReactNode;trailingToolbar?:ReactNode;notice?:ReactNode;floor?:RestaurantFloor;
 loadPrintEntries?:()=>Promise<ReservationBoardEntry[]>;printContext?:string;title?:string;compact?:boolean;dates?:string[];slots?:ReservationBoardSlot[];
 onSlot?:(resourceId:string,startsAt:string)=>void;
}) {
 const [now,setNow]=useState(()=>new Date())
 useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(timer)},[])
 const [localAxis,setLocalAxis]=useState(controlledAxis),[error,setError]=useState(''),[printing,setPrinting]=useState(false),[printRows,setPrintRows]=useState<ReservationBoardEntry[]|null>(null)
 const axisAnchor=useRef<HTMLButtonElement|null>(null),[axisMenu,setAxisMenu]=useState(false)
 const drag=useRef<ReservationBoardEntry|null>(null)
 const axis=onAxis?controlledAxis:localAxis
 useEffect(()=>{setLocalAxis(controlledAxis)},[controlledAxis])
 useEffect(()=>{const end=()=>setPrinting(false);window.addEventListener('afterprint',end);return ()=>window.removeEventListener('afterprint',end)},[])
 const change=(value:ReservationAxis)=>{setLocalAxis(value);onAxis?.(value)}
 const kind=requestedKind??entries[0]?.kind??'seats'
 const from=Math.min(kind==='people'?9*60:17*60,...entries.map(e=>Math.floor(minutes(e.startsAt)/60)*60))
 const to=Math.max(kind==='people'?18*60:23*60,...entries.map(e=>Math.ceil((minutes(e.startsAt)+(Date.parse(e.endsAt)-Date.parse(e.startsAt))/60000)/60)*60))
 const hours=useMemo(()=>Array.from({length:Math.max(1,(to-from)/60)},(_,i)=>from+i*60),[from,to])
 const days=dates?.length?dates:[...new Set(entries.map(e=>dayKey(e.startsAt)))].sort()
 const renderedDays=days.length?days:[jstDate()]
 const print=async()=>{
  setError('');setPrinting(true)
  try{setPrintRows(loadPrintEntries?await loadPrintEntries():entries);requestAnimationFrame(()=>requestAnimationFrame(()=>{try{window.print()}finally{setPrinting(false)}}))}
  catch{setError('印刷する予約を読み込めませんでした。もう一度試してください。');setPrinting(false)}
 }
 const drop=async(resourceId:string,date:string,event:DragEvent<HTMLDivElement>)=>{
  event.preventDefault();const entry=drag.current;drag.current=null;if(!entry||!canWrite||busy||!onMove)return
  const rect=event.currentTarget.getBoundingClientRect();if(rect.width<=0||!Number.isFinite(event.clientX))return;const minute=Math.max(from,Math.min(to-30,from+Math.round(((event.clientX-rect.left)/rect.width*(to-from))/30)*30))
  const startsAt=new Date(Date.parse(date+'T00:00:00+09:00')+minute*60000).toISOString()
  const endsAt=new Date(Date.parse(startsAt)+Date.parse(entry.endsAt)-Date.parse(entry.startsAt)).toISOString()
  setError('');try{await onMove(entry.id,entry.kind==='seats'?{kind:'seats',expectedVersion:entry.version,startsAt,endsAt,tableId:resourceId}:{kind:'people',expectedVersion:entry.version,startsAt,staffId:resourceId})}
  catch{setError('移動できませんでした。予約は元のままです。最新の予約を読み込んでください。')}
 }
 const list=(rows:ReservationBoardEntry[],paper=false)=>{
  const dining=columns==='dining'||paper&&kind==='seats',today=columns==='today'&&!paper
  return <DataTable className={diningContentColumns&&dining&&!paper?styles.contentCols:undefined} columnSizing={diningContentColumns&&dining&&!paper?'content':undefined} grid={!paper?{columns:today?'60px 124px 48px 64px 100px 100px'+(actions&&canWrite?' 80px':'')+(menus&&canWrite?' 32px':''):dining?'78px 96px minmax(80px,1fr) 40px 96px 96px 80px 84px'+(actions&&canWrite?' 32px':''):'72px minmax(90px,1fr) 40px 80px 90px 90px'+(actions&&canWrite?' 100px':''),compactColumns:undefined,gap:'6px',padding:today?'7px 16px':'8px 16px',rowHeight:dining?'56px':'50px',headPadding:'10px 16px'}:undefined}><thead><TableHeadRow><Th>時刻</Th>{dining?<Th>予約元</Th>:null}<Th grow={diningContentColumns&&dining}>{today?'名前':'お客さま'}</Th><Th>人数</Th><Th>{dining||today?'卓':'卓・担当'}</Th>{dining?<><Th>コース</Th><Th>注意事項</Th></>:<Th>{today?'経路':'予約元'}</Th>}<Th>状態</Th>{actions&&canWrite&&!paper?<Th>{dining?'':'来店'}</Th>:null}{menus&&canWrite&&!paper?<Th/>:null}</TableHeadRow></thead><tbody>{rows.map(e=><Tr key={e.kind+e.id} selected={selectedId?e.id===selectedId:undefined}>
   <Td>{paper||renderedDays.length>1||dining?`${dayKey(e.startsAt).slice(5).replace('-','/')} ${hm(e.startsAt)}`:hm(e.startsAt)}</Td>
   {dining?<Td><ReservationSource value={e.source} note={e.note}/></Td>:null}
   <Td grow={diningContentColumns&&dining}>{paper?e.customerName:<><>{diningContentColumns&&dining?<RowNameButton title={e.customerName} onClick={()=>onOpen(e.id)}>{e.customerName}</RowNameButton>:<Button presentation="restaurant" variant="text" textTone="ink" size="inline" onClick={()=>onOpen(e.id)}>{e.customerName}</Button>}</>{dining&&e.contactLabel?<span className={styles.contact}>{e.contactLabel}</span>:null}</>}</Td>
   <Td>{e.guestCount}</Td><Td>{e.resourceIds.length?(paper?e.resourceIds.map(id=>resources.find(r=>r.id===id)?.label??e.resourceLabel??id).join('＋'):<TruncatedText value={e.resourceIds.length>1?e.resourceIds.map(id=>resources.find(r=>r.id===id)?.label??id).join('＋'):e.resourceLabel??resources.find(r=>r.id===e.resourceIds[0])?.label??'—'}/>):<StatusBadge tone="warning">未配席</StatusBadge>}</Td>
   {dining?<><Td>{paper?`${e.courseName??'席のみ'}${e.dining?.courseAllergens?.length?'（含む：'+e.dining.courseAllergens.join('・')+'）':''}`:<TruncatedText value={e.courseName??'席のみ'}/>}</Td><Td>{paper?[e.dining?.allergy?'予約時：'+e.dining.allergy:'',e.currentAllergy?'今回：'+e.currentAllergy:'',e.dining?.anniversary?'記念日：'+e.dining.anniversary:'',e.dining?.seatPreference?'席の好み：'+e.dining.seatPreference:''].filter(Boolean).join(' ／ ')||'—':e.currentAllergy||e.dining?.allergy?diningContentColumns?<TruncatedText value={e.currentAllergy||e.dining?.allergy||'—'}/>:<StatusBadge size="dining" tone="info" surface="white">{e.currentAllergy||e.dining?.allergy}</StatusBadge>:'—'}</Td></>:<Td><ReservationSource value={e.source} note={e.note}/></Td>}
   <Td>{paper?(e.holdExpiresAt?'押さえ':e.status==='confirmed'?'予約確定':(e.departedAt?'退店済み':state(e.status))):<BookingStatus state={reservationBookingState(e)}>{e.holdExpiresAt?'押さえ':e.status==='confirmed'?(dining?'予約確定':'予約中'):(e.departedAt?'退店済み':state(e.status))}</BookingStatus>}</Td>{actions&&canWrite&&!paper?<Td>{actions(e)}</Td>:null}{menus&&canWrite&&!paper?<Td>{menus(e)}</Td>:null}
  </Tr>)}</tbody></DataTable>
 }
 const timeline=(date:string)=>{
  if(kind==='people'&&timeDirection==='vertical')return <ReservationPeopleGrid key={date} breaks={breaks} date={date} entries={entries} resources={resources} slots={slots} canWrite={canWrite} busy={busy} onOpen={onOpen} onMove={onMove} onSlot={onSlot} onError={setError}/>
  const rows=entries.filter(e=>dayKey(e.startsAt)===date)
  return <div className={styles.timeline} key={date}>{renderedDays.length>1?<h3 className={styles.day}>{date}</h3>:null}
  <div className={styles.timeHead}>{hours.map(m=><span key={m}>{`${Math.floor(m/60)}:00`}</span>)}</div>
  {resources.filter(r=>r.active||rows.some(e=>e.resourceIds.includes(r.id))).map(resource=><div className={styles.resource} key={resource.id}><strong title={resource.label}>{resource.label}</strong><div className={styles.track} data-resource-id={resource.id} style={{backgroundSize:`${100/hours.length}% 100%`}} onDragOver={e=>{if(canWrite&&onMove)e.preventDefault()}} onDrop={e=>void drop(resource.id,date,e)}>
  {canWrite&&!busy?(slots??(onSlot?hours.map(m=>({resourceId:resource.id,startsAt:new Date(Date.parse(date+'T00:00:00+09:00')+m*60000).toISOString(),href:undefined})):[])).filter(s=>s.resourceId===resource.id&&dayKey(s.startsAt)===date).map(s=><div className={styles.emptySlot} key={s.startsAt} style={{left:`${(minutes(s.startsAt)-from)/(to-from)*100}%`,width:`${30/(to-from)*100}%`}}>{s.href?<Button presentation="restaurant" href={s.href}>あき ＋</Button>:<BookingSlot onClick={()=>onSlot?.(resource.id,s.startsAt)} aria-label={`${resource.label} ${hm(s.startsAt)}に予約を入れる`}>{slots ? '空き' : '予約追加'}</BookingSlot>}</div>):null}
  {rows.filter(e=>e.resourceIds.includes(resource.id)).map(e=>{const left=(minutes(e.startsAt)-from)/(to-from)*100,width=Math.max(2,(Date.parse(e.endsAt)-Date.parse(e.startsAt))/60000/(to-from)*100);const overlapping=rows.filter(other=>other.id!==e.id&&other.resourceIds.includes(resource.id)&&reservationOccupies(other.status,other.holdExpiresAt,now.getTime(),other.departedAt??null)&&Date.parse(other.startsAt)<Date.parse(e.endsAt)&&Date.parse(other.endsAt)>Date.parse(e.startsAt));const over=reservationOccupies(e.status,e.holdExpiresAt,now.getTime(),e.departedAt??null)&&overlapping.length>=(kind==='seats'?1:Math.max(1,resource.capacity));return <div key={e.id} className={styles.booking} style={{left:`${left}%`,width:`${Math.min(width,100-left)}%`}}>
  <BookingBlock placement="timeline" state={over?'attention':reservationBookingState(e)} draggable={canWrite&&!!onMove&&!busy} onDragStart={()=>{drag.current=e}} onDragEnd={()=>{drag.current=null}} onClick={()=>onOpen(e.id)} aria-label={kind==='people'?`${e.customerName} ${hm(e.startsAt)} ${e.courseName??'予約'}の詳細`:`${e.customerName} ${e.guestCount}名 ${hm(e.startsAt)} ${(e.departedAt?'退店済み':state(e.status))}`}><BookingName>{e.customerName}{e.currentAllergy||e.dining?.allergy?<span>{`⚠ ${e.currentAllergy||e.dining?.allergy}`}</span>:null}</BookingName><BookingSummary time={`${hm(e.startsAt)}〜${hm(e.endsAt)}`}><ReservationSource value={e.source} note={e.note}/>・<span>{over?'重なり・受付数超過':e.holdExpiresAt?'仮押さえ':state(e.status)}</span>・{e.guestCount}名</BookingSummary></BookingBlock></div>})}
  {rows.filter(e=>e.resourceIds.includes(resource.id)&&!['completed','attention','no_show'].includes(reservationBookingState(e))).sort((a,b)=>a.startsAt.localeCompare(b.startsAt)).map((e,i,ordered)=>{const next=ordered[i+1];if(!next)return null;const gap=reservationGapMinutes(e,next);if(gap<15||ordered.some(other=>other.id!==e.id&&other.id!==next.id&&Date.parse(other.startsAt)<Date.parse(next.startsAt)&&Date.parse(other.endsAt)>Date.parse(e.endsAt)))return null;return <BookingGap key={`gap-${e.id}`} minutes={gap} style={{left:`${(minutes(e.endsAt)-from)/(to-from)*100}%`,width:`${gap/(to-from)*100}%`}}/>})}
  </div></div>)}{date===japanDate(now)&&minutes(now.toISOString())>=from&&minutes(now.toISOString())<to?<div className={styles.nowTrack}><BookingNowLine labelPosition="above" time={hm(now.toISOString())} style={{left:`${(minutes(now.toISOString())-from)/(to-from)*100}%`}}/></div>:null}{rows.filter(e=>!e.resourceIds.length).map(e=><Button presentation="restaurant" key={e.id} onClick={()=>onOpen(e.id)}>{`${e.customerName}・未配席`}</Button>)}</div>
 }
 const boardBody = axis==='floor'&&floor ? <RestaurantFloorMap floor={floor} labels={resources} onSelect={id=>{const e=entries.find(e=>e.resourceIds.includes(id));if(e)onOpen(e.id)}}/> : axis==='list'||compact ? renderList?.()??list(entries) : axis==='month' ? <ReservationMonth month={renderedDays[0].slice(0,7)} entries={entries} onOpen={onOpen} readableNames={monthNamePresentation==='readable'}/> : <>{renderedDays.map(timeline)}</>
 const contents = <>
 <div className={styles.toolbar}>{toolbar}{columns==='today'?<><IconButton aria-label="印刷" onClick={()=>void print()} disabled={printing}><Printer size={16}/></IconButton><button ref={axisAnchor} type="button" className={styles.axisButton} aria-label={`予約の軸：${axisName[axis]}`} aria-haspopup="menu" aria-expanded={axisMenu} onClick={()=>setAxisMenu(!axisMenu)}>{axisName[axis]}</button><ActionMenu open={axisMenu} anchorRef={axisAnchor} onClose={()=>setAxisMenu(false)} items={(['list','resource',...(floor?['floor']:[]),'month'] as ReservationAxis[]).map(value=>({id:value,label:axisName[value],onSelect:()=>change(value)}))}/></>:!compact?<SegmentedControl appearance="reservation" aria-label="予約の軸" value={axis} onChange={change} options={[{value:'resource',label:kind==='people'?'時間×スタッフ':'時間×卓'},...(floor?[{value:'floor' as const,label:'座席表'}]:[]),{value:'list',label:'一覧'},{value:'month',label:'月'}]}/>:null}{trailingToolbar}{columns!=='today'?<Button presentation="restaurant" busyLabel="印刷" doneLabel="印刷" busy={printing} onClick={()=>void print()}><Printer size={16}/>印刷</Button>:null}</div>
 {!compact&&axis!=='list'?<div className={styles.stateLegend}><BookingLegend/></div>:null}
 {error?<Notice tone="danger">{error}</Notice>:null}{notice}
 <div className={styles.screen}><CalendarPeriod period={axis==='month'?renderedDays[0].slice(0,7):axis==='resource'?renderedDays[0]:''} scope={axis}>{renderBody?renderBody(boardBody):boardBody}</CalendarPeriod></div>
 {printing?createPortal(<div data-reservation-print data-theme="v8" className={styles.print}><h2>{title}（{axisName[axis]}）</h2><p>{printContext??[...new Set((printRows??entries).map(e=>e.scopeId))].join('・')}</p><p>{renderedDays[0]}〜{renderedDays.at(-1)}</p>{axis!=='list'?<ReservationBoard kind={kind} entries={printRows??entries} resources={resources} axis={axis} floor={floor} dates={renderedDays} onOpen={()=>{}} title={title}/>:null}{list(printRows??entries,true)}</div>,document.body):null}
 </>
 const props={className:styles.board,'data-kind':kind,'data-columns':columns,'aria-label':title,'data-reservation-board':true,'data-list-skeleton':axis==='list'||compact?true:undefined,'data-print-active':printing?'true':undefined,'data-axis':axis}
 return renderBody||compact||kind==='people'&&timeDirection==='vertical'?<section {...props}>{contents}</section>:<Card frame="inset" overflow="hidden" {...props}>{contents}</Card>
}
