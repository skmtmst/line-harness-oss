'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {Copy,Minus,Plus,X} from 'lucide-react'
import {floorBoxInside,floorBoxesOverlap,type RestaurantFloor,type ReservationBoardResource} from '@line-crm/shared'
import {reservationBoardApi} from '@/lib/api/helpers/reservation-board'
import {restaurantTestApi} from '@/lib/restaurant-test-api'
import {useUnsavedGuard} from '@/lib/use-unsaved-guard'
import {UnsavedLeaveDialog} from '@/lib/unsaved-leave-dialog'
import Notice from './notice'
import RestaurantFloorMap from './restaurant-floor-map'
import {SaveErrorField,SaveErrorScope,useSaveFormErrors} from './save-form-errors'
import styles from './restaurant-floor-editor.module.css'

type PatternKey='two'|'four'|'counter'|'six'
type Arrangement='horizontal'|'vertical'|'grid'
const patterns:Record<PatternKey,{label:string;seatType:string;shape:string;min:number;max:number;width:number;height:number}>={
 two:{label:'2名テーブル',seatType:'table',shape:'rectangle',min:1,max:2,width:80,height:64},
 four:{label:'4名テーブル',seatType:'table',shape:'rectangle',min:1,max:4,width:80,height:64},
 counter:{label:'カウンター1名',seatType:'counter',shape:'counter',min:1,max:1,width:64,height:80},
 six:{label:'長方形6名',seatType:'table',shape:'long',min:1,max:6,width:120,height:64},
}
function positions(floor:RestaurantFloor,count:number,arrangement:Arrangement,width:number,height:number){
 const stepX=width+35,stepY=height+40
 for(let y=30;y<floor.height-height;y+=10)for(let x=30;x<floor.width-width;x+=10){
  const candidates=Array.from({length:count},(_,i)=>({id:'new-'+i,x:x+(arrangement==='vertical'?0:arrangement==='grid'?i%2*stepX:i*stepX),y:y+(arrangement==='horizontal'?0:arrangement==='grid'?Math.floor(i/2)*stepY:i*stepY),width,height,rotation:0}))
  if(candidates.every(c=>floorBoxInside(c,floor.width,floor.height)&&!floor.tables.some(t=>floorBoxesOverlap(c,t)))&&candidates.every((c,i)=>candidates.slice(i+1).every(other=>!floorBoxesOverlap(c,other))))return candidates
 }
 return null
}
export default function RestaurantFloorEditor({accountId,storeId,resources,canEdit,onSelect,refreshKey,onCreated,selectedId,duplicateRequest,existingCodes=[]}:{accountId:string;storeId:string;resources:ReservationBoardResource[];canEdit:boolean;onSelect:(id:string)=>void;refreshKey?:string;onCreated?:()=>Promise<void>;selectedId?:string;duplicateRequest?:number;existingCodes?:string[]}){
 const [floors,setFloors]=useState<RestaurantFloor[]>([]),[draft,setDraft]=useState<RestaurantFloor|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[refreshPending,setRefreshPending]=useState(false)
 const [zoom,setZoom]=useState(100),[modal,setModal]=useState<'add'|'pattern'|'duplicate'|null>(null),[newKind,setNewKind]=useState<'floor'|'area'>('floor'),[newName,setNewName]=useState(''),[parent,setParent]=useState('')
 const [pattern,setPattern]=useState<PatternKey>('two'),[count,setCount]=useState(2),[arrangement,setArrangement]=useState<Arrangement>('horizontal'),[source,setSource]=useState('')
 const saveErrors=useSaveFormErrors()
 const observed=useRef(''),latest=useRef(0)
 const resourceKey=JSON.stringify([refreshKey??'',resources.map(r=>r.id).sort()])
 const load=useCallback(async()=>{const ticket=++latest.current,requested=observed.current;setLoading(true);setError('');try{const result=await reservationBoardApi.floors(accountId,storeId);if(!Array.isArray(result.data))throw Error('invalid floor');if(ticket!==latest.current)return;setFloors(result.data);setDraft(current=>result.data.find(f=>f.id===current?.id)??result.data[0]??null);setRefreshPending(observed.current!==requested)}catch{if(ticket===latest.current)setError('座席図を読み込めませんでした。')}finally{if(ticket===latest.current)setLoading(false)}},[accountId,storeId])
 useEffect(()=>{observed.current=resourceKey;setFloors([]);setDraft(null);setSelected('');setZoom(100);void load();return()=>{latest.current++}},[accountId,storeId]) // eslint-disable-line react-hooks/exhaustive-deps
 const dirty=!!draft&&JSON.stringify(draft)!==JSON.stringify(floors.find(f=>f.id===draft.id))
 const guard=useUnsavedGuard({dirty,busy:busy||loading})
 useEffect(()=>{if(observed.current!==resourceKey){observed.current=resourceKey;setRefreshPending(true)}},[resourceKey])
 useEffect(()=>{if(refreshPending&&!dirty&&!busy&&!loading){setRefreshPending(false);void load()}},[refreshPending,dirty,busy,loading,load])
 const save=async()=>{if(!draft||!canEdit||busy)return;setBusy(true);setError('');try{await reservationBoardApi.saveFloor(accountId,{...draft,expectedVersion:draft.version});const next={...draft,version:draft.version+1};setDraft(next);setFloors(fs=>fs.map(f=>f.id===next.id?next:f))}catch(cause){saveErrors.capture(cause);setError('保存できませんでした。版が変わった場合は、入力を控えて最新の座席図を読み込んでください。')}finally{setBusy(false)}}
 const addFloor=async()=>{if(!newName.trim()){setError('階・エリアの名前を入れてください。');return}if(newKind==='area'&&!parent){setError('所属する階を選んでください。');return}setBusy(true);setError('');try{await reservationBoardApi.createFloor(accountId,storeId,newName.trim(),newKind,newKind==='area'?parent:null);setNewName('');setModal(null);await load()}catch{setError('階・エリアを追加できませんでした。名前と権限を確認してください。')}finally{setBusy(false)}}
 const createMany=async()=>{
  if(!draft||!canEdit||busy||!count)return
  const original=draft.tables.find(t=>t.id===source)
  const preset=modal==='duplicate'&&original
   ?{seatType:original.seatType??'table',seatDetailType:original.seatDetailType??original.seatType??'table',shape:original.shape,min:original.minCapacity??1,max:original.maxCapacity??2,width:original.width,height:original.height}
   :patterns[pattern]
  const spots=positions(draft,count,arrangement,preset.width,preset.height)
  if(!spots){setError('この階には選んだ配置の空きがありません。数や並べ方を変えてください。');return}
  setBusy(true);setError('')
  const createdIds:string[]=[]
  let created=0,failed=false
  let resultError=''
  try{
   const used=new Set([...existingCodes,...resources.map(r=>r.label)])
   let nextNo=1
   for(const spot of spots){
    while(used.has(String(nextNo))||used.has('テーブル'+nextNo)||used.has('カウンター'+nextNo))nextNo++
    const number=nextNo++,code=String(number),label=preset.seatType==='counter'?'カウンター'+number:'テーブル'+number
    used.add(code)
    const result=await restaurantTestApi.createTable(accountId,{storeId,floorId:draft.id,code,label,seatType:preset.seatType,seatDetailType:'seatDetailType' in preset?preset.seatDetailType:preset.seatType,minCapacity:preset.min,maxCapacity:preset.max,floorX:spot.x,floorY:spot.y,shape:preset.shape,width:preset.width,height:preset.height,rotation:0,smokingPolicy:original?.smokingPolicy??'non_smoking',partition:original?.partition??'open',shoesAllowed:original?.shoesAllowed??true,visibleOnMap:true,chairArrangement:original?.chairArrangement??'both',chairSide:original?.chairSide??null,isActive:false}) as {data?:{id?:string}}
    if(result.data?.id)createdIds.push(result.data.id)
    created++
   }
  }catch{failed=true}
  if(failed){
   let removed=0
   for(const id of createdIds.reverse()){try{await restaurantTestApi.deleteTable(accountId,id);removed++}catch{/* the remaining count is shown below */}}
   resultError=created>removed?`${created-removed}卓が残りました。作成結果を座席図で確認してください。`:'卓を作成できませんでした。入力と配置を確認してください。'
  }else setModal(null)
  try{await onCreated?.();await load()}catch{resultError=resultError||'座席図を読み直せませんでした。再読み込みしてください。'}
  if(resultError)setError(resultError)
  setBusy(false)
 }

 const selectedTable=draft?.tables.find(t=>t.id===selected)
 const openModal=(name:'add'|'pattern'|'duplicate')=>{setError('');setModal(name);setParent(floors.find(f=>f.kind!=='area')?.id??'');setSource(selectedTable?.id??draft?.tables[0]?.id??'')}
 useEffect(()=>{if(selectedId)setSelected(selectedId)},[selectedId])
 useEffect(()=>{if(duplicateRequest)openModal('duplicate')},[duplicateRequest]) // eslint-disable-line react-hooks/exhaustive-deps
 const viewBox=draft?`0 0 ${draft.width*100/zoom} ${draft.height*100/zoom}`:undefined
 return <SaveErrorScope errors={saveErrors}><div className={styles.editor}>
  {loading?<p className={styles.note} role="status">座席図を読み込み中です。</p>:null}
  {refreshPending&&dirty?<Notice tone="warn">卓の情報が変わりました。配置の変更は残しています。<button type="button" onClick={()=>guard.guarded(()=>void load())}>最新の座席図を読み込む</button></Notice>:null}
  {error?<Notice tone="danger">{error}<button type="button" onClick={()=>guard.guarded(()=>void load())}>もう一度読み込む</button></Notice>:null}
  {draft?<><div className={styles.top}><div className={styles.tabs} role="tablist" aria-label="階・エリア">{floors.map(f=><button type="button" role="tab" aria-selected={f.id===draft.id} key={f.id} className={f.id===draft.id?styles.activeTab:''} onClick={()=>guard.guarded(()=>{setDraft(f);setSelected('');setZoom(100)})}>{f.name}</button>)}</div>{canEdit?<button type="button" className={styles.outlineButton} disabled={busy||loading} onClick={()=>openModal('add')}><Plus size={16}/>階・エリアを追加</button>:null}</div>
   {canEdit?<div className={styles.actionLine}><button type="button" className={styles.outlineButton} disabled={busy||loading} onClick={()=>openModal('pattern')}><Plus size={16}/>配置パターンから追加</button>{selectedTable?<button type="button" className={styles.duplicateInline} disabled={busy||loading} onClick={()=>openModal('duplicate')}><Copy size={15}/>選択した卓を複製</button>:null}</div>:null}
   <div className={styles.mapFrame} onWheel={e=>{if(e.ctrlKey){e.preventDefault();setZoom(z=>Math.min(250,Math.max(50,z+(e.deltaY<0?10:-10))))}}}>
    <span className={styles.entry}>入口</span><SaveErrorField names={['tables']}><RestaurantFloorMap floor={draft} labels={resources} viewport={viewBox} canEdit={canEdit&&!busy&&!loading} penTableStyle selectedId={selected} onSelect={id=>{setSelected(id);if(!id.startsWith('fixture:'))onSelect(id)}} onChange={tables=>setDraft({...draft,tables})}/></SaveErrorField>
    <div className={styles.zoom}><button type="button" aria-label="縮小" onClick={()=>setZoom(z=>Math.max(50,z-10))}><Minus size={15}/></button><span>{zoom}%</span><button type="button" aria-label="拡大" onClick={()=>setZoom(z=>Math.min(250,z+10))}><Plus size={15}/></button></div>
   </div><p className={styles.note}>禁煙・土足は卓内のマークで確認。＋／−またはトラックパッドのピンチで拡大・縮小できます。</p>
   {dirty&&canEdit?<button type="button" className={styles.saveButton} disabled={busy||loading} onClick={()=>void save()}>座席図を保存</button>:null}
  </>:null}
  {modal?<div className={styles.backdrop} role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setModal(null)}}><div className={styles.dialog} role="dialog" aria-modal="true" aria-label={modal==='add'?'階・エリアを追加':modal==='pattern'?'配置パターンから追加':'選択した卓を複製'}><header><strong>{modal==='add'?'階・エリアを追加':modal==='pattern'?'配置パターンから追加':'選択した卓を複製'}</strong><button type="button" aria-label="閉じる" onClick={()=>setModal(null)}><X size={18}/></button></header><div className={styles.dialogBody}>
   {modal==='add'?<><p>階を作成し、必要に応じてその階にエリアを追加します。</p><div className={styles.segment}><button type="button" aria-pressed={newKind==='floor'} onClick={()=>setNewKind('floor')}>階を追加</button><button type="button" aria-pressed={newKind==='area'} onClick={()=>setNewKind('area')}>エリアを追加</button></div>{newKind==='area'?<label>所属する階 <span>必須</span><select value={parent} onChange={e=>setParent(e.target.value)}>{floors.filter(f=>f.kind!=='area').map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>:null}<label>{newKind==='floor'?'階の名前':'エリアの名前'} <span>必須</span><input value={newName} onChange={e=>setNewName(e.target.value)} placeholder={newKind==='floor'?'例：2階':'例：テラス'}/></label></>:<>
    {modal==='pattern'?<><p>よく使う卓を選んで、まとめて配置できます。</p><div className={styles.patterns}>{(Object.entries(patterns) as [PatternKey,typeof patterns[PatternKey]][]).map(([key,p])=><button type="button" key={key} aria-pressed={pattern===key} onClick={()=>setPattern(key)}><span className={styles.patternIcon}>{p.shape==='circle'?'◯':p.shape==='counter'?'▯':'▭'}</span><strong>{p.label}</strong><small>{p.max}名</small></button>)}</div></>:<><p>選んだ卓と同じ形・席条件の卓を作れます。</p><label>複製する卓<select value={source} onChange={e=>setSource(e.target.value)}>{draft?.tables.map(t=><option key={t.id} value={t.id}>{resources.find(r=>r.id===t.id)?.label??t.id}</option>)}</select></label></>}
    <div className={styles.group}>作成する数 <span>必須</span><div className={styles.stepper}><button type="button" onClick={()=>setCount(n=>Math.max(1,n-1))}>−</button><output>{count}卓</output><button type="button" onClick={()=>setCount(n=>Math.min(20,n+1))}>＋</button></div></div>
    <div className={styles.group}>並べ方<div className={styles.segment}>{([['horizontal','横並び'],['vertical','縦並び'],['grid','2列に並べる']] as [Arrangement,string][]).map(([key,label])=><button type="button" key={key} aria-pressed={arrangement===key} onClick={()=>setArrangement(key)}>{label}</button>)}</div></div>
    <div className={styles.batchPreview}><strong>配置プレビュー</strong><div>{Array.from({length:Math.min(count,8)},(_,i)=><span key={i}>{modal==='pattern'?patterns[pattern].max:draft?.tables.find(t=>t.id===source)?.maxCapacity??2}名</span>)}</div><p>卓番と表示名は自動で付けます。作成後は「停止中」から始まります。</p></div>
   </>}
  </div><footer><button type="button" onClick={()=>setModal(null)}>キャンセル</button><button type="button" className={styles.primary} disabled={busy} onClick={()=>void(modal==='add'?addFloor():createMany())}><Plus size={16}/>{modal==='add'?'追加する':count+'卓を作る'}</button></footer></div></div>:null}
  <UnsavedLeaveDialog open={guard.leaveTarget!==null} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} busy={busy} subject="座席図の変更"/>
 </div></SaveErrorScope>
}
