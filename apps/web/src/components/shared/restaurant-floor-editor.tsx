'use client'
import {PenLine,Undo2} from 'lucide-react'
import {useCallback,useEffect,useRef,useState} from 'react'
import type {RestaurantFloor,ReservationBoardResource} from '@line-crm/shared'
import Button from './button'
import Notice from './notice'
import {Tabs} from './tabs'
import FilterChip from './filter-chip'
import ActionMenu from './action-menu'
import {Field,TextInput} from './form-controls'
import NumberInput from './number-field'
import {UnsavedLeaveDialog} from '@/lib/unsaved-leave-dialog'
import {reservationBoardApi} from '@/lib/api/helpers/reservation-board'
import {useUnsavedGuard} from '@/lib/use-unsaved-guard'
import RestaurantFloorMap,{floorTableViewBox} from './restaurant-floor-map'
import {SaveErrorField,SaveErrorScope,useSaveFormErrors} from './save-form-errors'
import styles from './restaurant-floor-editor.module.css'
type Shape=RestaurantFloor['tables'][number]['shape']
type FixtureKind=RestaurantFloor['fixtures'][number]['kind']
/* 座敷は卓の形の口に無い（機能待ち）。 */
const SHAPES:[Shape,string][]=[['rectangle','四角'],['circle','丸'],['long','長い卓'],['counter','カウンター席'],['sofa','ソファ']]
const FIXTURES:[FixtureKind,string][]=[['wall','壁'],['entrance','入口'],['kitchen','厨房'],['toilet','トイレ'],['window','窓']]
export default function RestaurantFloorEditor({accountId,storeId,resources,canEdit,onSelect,refreshKey}:{accountId:string;storeId:string;resources:ReservationBoardResource[];canEdit:boolean;onSelect:(id:string)=>void;refreshKey?:string}) {
 const [floors,setFloors]=useState<RestaurantFloor[]>([]),[draft,setDraft]=useState<RestaurantFloor|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState(''),[newFloor,setNewFloor]=useState(''),[drawing,setDrawing]=useState(false),[advanced,setAdvanced]=useState(false),[fixtureMenu,setFixtureMenu]=useState(false),[hint,setHint]=useState(false)
 const [loading,setLoading]=useState(false),[refreshPending,setRefreshPending]=useState(false),[viewport,setViewport]=useState<string>()
 const resourceKey=JSON.stringify([refreshKey??'',resources.map(r=>r.id).sort()])
 const observedResources=useRef(resourceKey)
 const fixtureAnchor=useRef<HTMLSpanElement>(null)
 const saveErrors=useSaveFormErrors()
 const latest=useRef(0)
 const load=useCallback(async()=>{const ticket=++latest.current,requestedResources=observedResources.current;setError('');setLoading(true);try{const r=await reservationBoardApi.floors(accountId,storeId);if(!Array.isArray(r.data))throw new Error('invalid_floor_response');if(ticket!==latest.current)return;setFloors(r.data);setDraft(current=>r.data.find(f=>f.id===current?.id)??r.data[0]??null);setViewport(undefined);setRefreshPending(observedResources.current!==requestedResources)}catch{if(ticket===latest.current)setError('座席図を読み込めませんでした。')}finally{if(ticket===latest.current)setLoading(false)}},[accountId,storeId])
 useEffect(()=>{observedResources.current=resourceKey;setRefreshPending(false);setViewport(undefined);setDraft(null);setFloors([]);setSelected('');setBusy(false);void load();return ()=>{latest.current++}},[accountId,storeId]) // eslint-disable-line react-hooks/exhaustive-deps
 const selectedTable=draft&&selected&&!selected.startsWith('fixture:')?draft.tables.find(t=>t.id===selected):undefined
 const dirty=!!draft&&JSON.stringify(draft)!==JSON.stringify(floors.find(f=>f.id===draft.id))
 const guard=useUnsavedGuard({dirty,busy:busy||loading})
 useEffect(()=>{if(observedResources.current!==resourceKey){observedResources.current=resourceKey;setRefreshPending(true)}},[resourceKey])
 useEffect(()=>{if(refreshPending&&!dirty&&!busy&&!loading){setRefreshPending(false);void load()}},[refreshPending,dirty,busy,loading,load])
 const save=async()=>{if(!draft||!canEdit||busy||loading)return;const ticket=latest.current;setBusy(true);setError('');try{await reservationBoardApi.saveFloor(accountId,{...draft,expectedVersion:draft.version});if(ticket!==latest.current)return;const next={...draft,version:draft.version+1};setDraft(next);setFloors(fs=>fs.map(f=>f.id===next.id?next:f))}catch(cause){if(ticket!==latest.current)return;saveErrors.capture(cause);setError('保存できませんでした。版が変わった場合は、入力を控えて最新の座席図を読み込んでください。')}finally{if(ticket===latest.current)setBusy(false)}}
 return <SaveErrorScope errors={saveErrors}><div className={styles.editor}>
 {loading?<p className={styles.paletteNote} role="status">座席図を読み込み中です。</p>:null}
 {refreshPending&&dirty?<Notice tone="warn">卓の情報が変わりました。配置の変更は残しています。<Button presentation="restaurant" disabled={busy||loading} onClick={()=>guard.guarded(()=>void load())}>最新の座席図を読み込む</Button></Notice>:null}
 {error?<Notice tone="danger">{error}<Button presentation="restaurant" disabled={busy||loading} onClick={()=>guard.guarded(()=>void load())}>もう一度読み込む</Button></Notice>:null}
 {draft?<>
 <div className={styles.tools}><Tabs label="階" size="compact" items={floors.map(f=>({label:f.name,current:f.id===draft.id,onClick:()=>guard.guarded(()=>{setDraft(f);setViewport(undefined);setSelected('')})}))}/><Button presentation="restaurant" disabled={drawing} onClick={()=>setViewport(floorTableViewBox(draft))}>卓に合わせて表示</Button><Button presentation="restaurant" onClick={()=>setViewport(undefined)}>全体を表示</Button>{canEdit?<><Button presentation="restaurant" aria-pressed={drawing} disabled={busy||loading} onClick={()=>{setViewport(undefined);if(!drawing)setDraft({...draft,outline:[]});setDrawing(!drawing)}}><PenLine size={16} aria-hidden/>{drawing?'外形を閉じる':'外形を線で描く'}</Button><Button presentation="restaurant" disabled={busy||loading} onClick={()=>setDraft(floors.find(f=>f.id===draft.id)??null)}><Undo2 size={16} aria-hidden/>元に戻す</Button></>:null}</div>
 <SaveErrorField names={["tables"]}><RestaurantFloorMap viewport={viewport} floor={draft} labels={resources} canEdit={canEdit&&!busy&&!loading} drawing={drawing} onFloorChange={setDraft} onSelect={id=>{setSelected(id);if(!id.startsWith('fixture:'))onSelect(id)}} onChange={tables=>setDraft({...draft,tables})}/></SaveErrorField>
 {canEdit?<>
 {/* 絵 vOtK2「置く」：つまんで置く札の並び。形の札は選んだ卓の形を変え、店の部品の札は選んで図に足す。 */}
 <div className={styles.palette} role="group" aria-label="つまんで置く">
 <span className={styles.paletteLabel}>つまんで置く：</span>
 {SHAPES.map(([shape,label])=><FilterChip disabled={busy||loading} key={shape} selectedIcon={false} selected={selectedTable?.shape===shape} onChange={()=>{if(!selectedTable){setHint(true);return}setHint(false);setDraft({...draft,tables:draft.tables.map(t=>t.id===selectedTable.id?{...t,shape}:t)})}}>{label}</FilterChip>)}
 <span ref={fixtureAnchor} className={styles.paletteAnchor}><FilterChip disabled={busy||loading} selectedIcon={false} selected={false} aria-haspopup="menu" aria-expanded={fixtureMenu} onChange={()=>setFixtureMenu(!fixtureMenu)}>壁・入口・厨房・トイレ・窓</FilterChip>
 <ActionMenu open={fixtureMenu} anchorRef={fixtureAnchor} ariaLabel="図に足す店の部品" onClose={()=>setFixtureMenu(false)} items={FIXTURES.map(([kind,label])=>({id:kind,label,onSelect:()=>{if(busy||loading)return;setFixtureMenu(false);setDraft({...draft,fixtures:[...draft.fixtures,{id:crypto.randomUUID(),kind,x:20+draft.fixtures.length*20,y:20,width:120,height:60}]})}}))}/></span>
 </div>
 <p className={styles.paletteNote} role={hint?'status':undefined}>{drawing?'角を順に押してください。閉じると最後の点から最初の点へつながります。':hint?'形を変える卓を、先に図の中で押してください。':'マス目に吸い付く・重なる所へは動かない・結合グループは緑の線・停止中は薄く・押すと右の行も選ぶ'}</p>
 {selected?<div className={styles.tools}>{(['width','height','rotation'] as const).filter(k=>!selected.startsWith('fixture:')||k!=='rotation').map(key=>{const item=selected.startsWith('fixture:')?draft.fixtures.find(t=>t.id===selected.slice(8)):draft.tables.find(t=>t.id===selected);if(!item)return null;return <Field key={key} label={{width:'幅',height:'高さ',rotation:'向き'}[key]}><NumberInput disabled={busy||loading} aria-label={{width:'幅',height:'高さ',rotation:'向き'}[key]} type="number" value={String(key==='rotation'&&'rotation' in item?item.rotation:key==='width'?item.width:item.height)} onChange={e=>{const n=Number(e.target.value);setDraft(selected.startsWith('fixture:')?{...draft,fixtures:draft.fixtures.map(t=>t.id===item.id?{...t,[key]:n}:t)}:{...draft,tables:draft.tables.map(t=>t.id===item.id?{...t,[key]:n}:t)})}}/></Field>})}{selected.startsWith('fixture:')?<Button presentation="restaurant" disabled={busy||loading} onClick={()=>{setDraft({...draft,fixtures:draft.fixtures.filter(t=>t.id!==selected.slice(8))});setSelected('')}}>図の部品を消す</Button>:null}</div>:null}
 <Button presentation="restaurant" size="inline" disabled={busy||loading} onClick={()=>setAdvanced(!advanced)} aria-expanded={advanced}>階・エリアを追加</Button>{advanced?<div className={styles.tools}>
 <Field label="階・エリアの名前"><TextInput disabled={busy||loading} aria-label="階・エリアを追加" value={newFloor} onChange={e=>setNewFloor(e.target.value)}/></Field><Button presentation="restaurant" disabled={!newFloor.trim()||busy||loading} onClick={()=>guard.guarded(()=>{setBusy(true);void reservationBoardApi.createFloor(accountId,storeId,newFloor).then(()=>{setNewFloor('');return load()}).catch(()=>setError('階を追加できませんでした。名前と権限を確認してください。')).finally(()=>setBusy(false))})}>追加</Button>
 </div>:null}{dirty?<Button presentation="restaurant" variant="primary" busy={busy} disabled={drawing||loading} onClick={()=>void save()}>座席図を保存</Button>:null}</>:null}
 </>:null}<UnsavedLeaveDialog open={guard.leaveTarget !== null} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} busy={busy} subject="座席図の変更"/></div></SaveErrorScope>
}
