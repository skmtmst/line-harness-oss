 'use client'
import { useCallback,useEffect,useRef,useState } from 'react'
import type { AdEventMapping } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'

function MappingEditor({mapping,accountId,canWrite,onSaved,onDirty}:{mapping:AdEventMapping;accountId:string;canWrite:boolean;onSaved:(m:AdEventMapping)=>void;onDirty:(id:string,dirty:boolean)=>void}) {
  const [mode,setMode]=useState(mapping.mode)
  const [name,setName]=useState(mapping.eventName??'')
  const [actionId,setActionId]=useState(mapping.googleActionId??'')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const dirty=mode!==mapping.mode||name!==(mapping.eventName??'')||actionId!==(mapping.googleActionId??'')
  useEffect(()=>{const id=`${mapping.pointId}:${mapping.provider}`;onDirty(id,dirty);return()=>onDirty(id,false)},[mapping.pointId,mapping.provider,dirty,onDirty])
  const save=async()=>{
    setBusy(true);setError('')
    try {
      const result=await api.adPlatforms.saveMapping(mapping.pointId,{account_id:accountId,provider:mapping.provider,mode,eventName:mode==='manual'?name:null,googleActionId:actionId||null,expectedVersion:mapping.version})
      if(!result.success) throw new Error(result.error)
      onSaved(result.data)
    } catch(caught) {setError(caught instanceof Error?caught.message:'保存できませんでした。読み直してください。')}
    finally {setBusy(false)}
  }
  return <div className="min-w-0 space-y-2">
    <Select aria-label={`${mapping.pointName} ${mapping.provider}の対応方法`} value={mode} disabled={!canWrite||busy} onChange={value=>setMode(value as AdEventMapping['mode'])} options={[{value:'auto',label:'自動で対応'},{value:'manual',label:'名前を指定する'},{value:'off',label:'送らない'}]} />
    {mode==='manual'?<input aria-label={`${mapping.pointName} ${mapping.provider}に返す名前`} maxLength={100} value={name} disabled={!canWrite||busy} onChange={event=>setName(event.target.value)} className="w-full rounded-control border border-hairline px-2 py-1" />:<p className="truncate text-xs" title={mapping.automaticEventName??'未対応'}>{mode==='off'?'送らない':mapping.automaticEventName??'自動の対応がありません'}</p>}
    {mapping.provider==='google'&&mode!=='off'&&<input aria-label={`${mapping.pointName} Googleの成果ID`} placeholder="成果ID（空欄は連携設定を使用）" value={actionId} disabled={!canWrite||busy} onChange={event=>setActionId(event.target.value)} className="w-full rounded-control border border-hairline px-2 py-1" />}
    {canWrite&&<Button variant="secondary" disabled={busy} onClick={()=>void save()}>保存</Button>}
    {error&&<p className="text-xs" role="alert">{error}</p>}
  </div>
}
export function AdEventMappings({accountId,canWrite}:{accountId:string;canWrite:boolean}) {
  const [items,setItems]=useState<AdEventMapping[]|null>(null)
  const [error,setError]=useState('')
  const generation=useRef(0)
  const [dirtyIds,setDirtyIds]=useState<Set<string>>(()=>new Set())
  const onDirty=useCallback((id:string,dirty:boolean)=>setDirtyIds(current=>{if(current.has(id)===dirty)return current;const next=new Set(current);if(dirty)next.add(id);else next.delete(id);return next}),[])
  const {leaveTarget,confirmLeave,cancelLeave}=useUnsavedGuard({dirty:dirtyIds.size>0})
  const load=()=>{
    const current=++generation.current;setItems(null);setError('')
    void api.adPlatforms.mappings(accountId).then(result=>{
      if(current!==generation.current)return
      if(!result.success)throw new Error(result.error)
      setItems(result.data)
    }).catch(()=>{if(current===generation.current)setError('対応表を読み込めませんでした。')})
  }
  useEffect(()=>{load();return()=>{generation.current++}},[accountId]) // eslint-disable-line react-hooks/exhaustive-deps
  if(error)return <div role="alert">{error}<Button variant="secondary" onClick={load}>読み直す</Button></div>
  if(!items)return <p>対応表を読み込んでいます…</p>
  if(items.length===0)return <p>成果地点がありません。成果地点を作るとここに並びます。</p>
  const ids=[...new Set(items.map(item=>item.pointId))]
  return <div className="space-y-3" data-design-node="FDBsG">
    <ConfirmDialog open={leaveTarget !== null} title="保存せずに移動しますか？" description="変更した広告の対応が失われます。" confirmLabel="保存せずに移動" onConfirm={confirmLeave} onCancel={cancelLeave} />
    <p className="text-xs">Googleの外部名称は自動取得しません。成果IDはGoogle広告で確認して入力できます。</p>
    <div className="grid grid-cols-3 gap-3 text-xs"><span>成果地点</span><span>Google広告に返す名前</span><span>Meta広告に返す名前</span></div>
    {ids.map(id=><div key={`${accountId}:${id}`} className="grid grid-cols-3 gap-3 border-t border-hairline pt-3">
      <p className="truncate text-sm" title={items.find(item=>item.pointId===id)?.pointName}>{items.find(item=>item.pointId===id)?.pointName}</p>
      {(['google','meta'] as const).map(provider=>{const item=items.find(item=>item.pointId===id&&item.provider===provider)!;return <MappingEditor key={`${accountId}:${id}:${provider}:${item.version}`} mapping={item} accountId={accountId} canWrite={canWrite} onDirty={onDirty} onSaved={saved=>setItems(current=>current?.map(m=>m.pointId===id&&m.provider===provider?saved:m)??null)}/>})}
    </div>)}
  </div>
}
