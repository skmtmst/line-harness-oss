'use client'
import {PenLine,Undo2} from 'lucide-react'
import {useEffect,useRef,useState} from 'react'
import type {RestaurantFloor,ReservationBoardResource} from '@line-crm/shared'
import Button from './button'
import Notice from './notice'
import {Tabs} from './tabs'
import Select from './select'
import {Field,TextInput} from './form-controls'
import NumberInput from './number-field'
import {UnsavedLeaveDialog} from '@/lib/unsaved-leave-dialog'
import {reservationBoardApi} from '@/lib/api-reservation-board'
import {useUnsavedGuard} from '@/lib/use-unsaved-guard'
import RestaurantFloorMap from './restaurant-floor-map'
import styles from './restaurant-floor-editor.module.css'
export default function RestaurantFloorEditor({accountId,storeId,resources,canEdit,onSelect}:{accountId:string;storeId:string;resources:ReservationBoardResource[];canEdit:boolean;onSelect:(id:string)=>void}) {
 const [floors,setFloors]=useState<RestaurantFloor[]>([]),[draft,setDraft]=useState<RestaurantFloor|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState(''),[newFloor,setNewFloor]=useState(''),[drawing,setDrawing]=useState(false),[advanced,setAdvanced]=useState(false),[fixture,setFixture]=useState<RestaurantFloor['fixtures'][number]['kind']>('wall')
 const latest=useRef(0)
 const load=async()=>{const ticket=++latest.current;setError('');try{const r=await reservationBoardApi.floors(accountId,storeId);if(!Array.isArray(r.data))throw new Error('invalid_floor_response');if(ticket!==latest.current)return;setFloors(r.data);setDraft(r.data[0]??null)}catch{if(ticket===latest.current)setError('座席図を読み込めませんでした。')}}
 useEffect(()=>{setDraft(null);setFloors([]);setSelected('');setBusy(false);void load();return ()=>{latest.current++}},[accountId,storeId]) // eslint-disable-line react-hooks/exhaustive-deps
 const dirty=!!draft&&JSON.stringify(draft)!==JSON.stringify(floors.find(f=>f.id===draft.id))
 const guard=useUnsavedGuard({dirty,busy})
 const save=async()=>{if(!draft||!canEdit||busy)return;const ticket=latest.current;setBusy(true);setError('');try{await reservationBoardApi.saveFloor(accountId,{...draft,expectedVersion:draft.version});if(ticket!==latest.current)return;const next={...draft,version:draft.version+1};setDraft(next);setFloors(fs=>fs.map(f=>f.id===next.id?next:f))}catch{if(ticket!==latest.current)return;setError('保存できませんでした。版が変わった場合は、入力を控えて最新の座席図を読み込んでください。')}finally{if(ticket===latest.current)setBusy(false)}}
 return <div className={styles.editor}>
 {error?<Notice tone="danger">{error}<Button presentation="restaurant" onClick={()=>guard.guarded(()=>void load())}>もう一度読み込む</Button></Notice>:null}
 {draft?<>
 <div className={styles.tools}><Tabs label="階" size="compact" items={floors.map(f=>({label:f.name,current:f.id===draft.id,onClick:()=>guard.guarded(()=>{setDraft(f);setSelected('')})}))}/>{canEdit?<><Button presentation="restaurant" aria-pressed={drawing} onClick={()=>{if(!drawing)setDraft({...draft,outline:[]});setDrawing(!drawing)}}><PenLine size={16} aria-hidden/>{drawing?'外形を閉じる':'外形を線で描く'}</Button><Button presentation="restaurant" onClick={()=>setDraft(floors.find(f=>f.id===draft.id)??null)}><Undo2 size={16} aria-hidden/>元に戻す</Button></>:null}</div>
 <RestaurantFloorMap floor={draft} labels={resources} canEdit={canEdit&&!busy} drawing={drawing} onFloorChange={setDraft} onSelect={id=>{setSelected(id);if(!id.startsWith('fixture:'))onSelect(id)}} onChange={tables=>setDraft({...draft,tables})}/>
 {canEdit?<><Button presentation="restaurant" size="inline" onClick={()=>setAdvanced(!advanced)} aria-expanded={advanced}>つまんで置く・卓の形・店の部品を編集</Button>{advanced||selected?<div className={styles.tools}>
 {selected&&!selected.startsWith('fixture:')?<Field label="卓の形"><Select aria-label="卓の形" value={draft.tables.find(t=>t.id===selected)?.shape??'rectangle'} onChange={shape=>setDraft({...draft,tables:draft.tables.map(t=>t.id===selected?{...t,shape:shape as typeof t.shape}:t)})} options={[{value:'rectangle',label:'四角'},{value:'circle',label:'丸'},{value:'long',label:'長い卓'},{value:'counter',label:'カウンター席'},{value:'sofa',label:'ソファ'}]}/></Field>:null}
 <Field label="店の形"><Select aria-label="店の形" value={fixture} onChange={v=>setFixture(v as typeof fixture)} options={[{value:'wall',label:'壁'},{value:'entrance',label:'入口'},{value:'kitchen',label:'厨房'},{value:'toilet',label:'トイレ'},{value:'window',label:'窓'}]}/></Field>
 <Button presentation="restaurant" onClick={()=>setDraft({...draft,fixtures:[...draft.fixtures,{id:crypto.randomUUID(),kind:fixture,x:20+draft.fixtures.length*20,y:20,width:120,height:60}]})}>図に追加する</Button>
 {drawing?<p>角を順に押してください。閉じると最後の点から最初の点へつながります。</p>:null}
 {selected?<>{(['width','height','rotation'] as const).filter(k=>!selected.startsWith('fixture:')||k!=='rotation').map(key=>{const item=selected.startsWith('fixture:')?draft.fixtures.find(t=>t.id===selected.slice(8)):draft.tables.find(t=>t.id===selected);if(!item)return null;return <Field key={key} label={{width:'幅',height:'高さ',rotation:'向き'}[key]}><NumberInput aria-label={{width:'幅',height:'高さ',rotation:'向き'}[key]} type="number" value={String(key==='rotation'&&'rotation' in item?item.rotation:key==='width'?item.width:item.height)} onChange={e=>{const n=Number(e.target.value);setDraft(selected.startsWith('fixture:')?{...draft,fixtures:draft.fixtures.map(t=>t.id===item.id?{...t,[key]:n}:t)}:{...draft,tables:draft.tables.map(t=>t.id===item.id?{...t,[key]:n}:t)})}}/></Field>})}{selected.startsWith('fixture:')?<Button presentation="restaurant" onClick={()=>{setDraft({...draft,fixtures:draft.fixtures.filter(t=>t.id!==selected.slice(8))});setSelected('')}}>図の部品を消す</Button>:null}</>:null}
 <Field label="階・エリアを追加"><TextInput aria-label="階・エリアを追加" value={newFloor} onChange={e=>setNewFloor(e.target.value)}/></Field><Button presentation="restaurant" disabled={!newFloor.trim()||busy} onClick={()=>guard.guarded(()=>{setBusy(true);void reservationBoardApi.createFloor(accountId,storeId,newFloor).then(()=>{setNewFloor('');return load()}).catch(()=>setError('階を追加できませんでした。名前と権限を確認してください。')).finally(()=>setBusy(false))})}>追加</Button>

 </div>:null}{dirty?<Button presentation="restaurant" variant="primary" busy={busy} disabled={drawing} onClick={()=>void save()}>座席図を保存</Button>:null}</>:null}
 </>:null}<UnsavedLeaveDialog open={guard.leaveTarget !== null} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} busy={busy} subject="座席図の変更"/></div>
}
