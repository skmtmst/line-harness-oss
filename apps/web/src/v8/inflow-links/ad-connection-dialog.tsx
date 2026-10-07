'use client'
import { useEffect, useRef, useState } from 'react'
import { api, type AdPlatform } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { TextField } from '@/components/shared/text-field'

type ConfigField = {key: string; label: string; secret?: boolean}
export const AD_CONNECTION_FIELDS: Record<string, ConfigField[]> = {
 meta:[{key:'ad_account_id',label:'広告アカウントID'},{key:'pixel_id',label:'ピクセルID'},{key:'access_token',label:'アクセストークン',secret:true}],
 google:[{key:'customer_id',label:'広告アカウントID'},{key:'conversion_action_id',label:'コンバージョンアクションID'},{key:'oauth_token',label:'アクセストークン',secret:true},{key:'developer_token',label:'開発者トークン',secret:true}],
 tiktok:[{key:'advertiser_id',label:'広告アカウントID'},{key:'pixel_code',label:'ピクセルコード'},{key:'access_token',label:'アクセストークン',secret:true}],
 x:[{key:'account_id',label:'広告アカウントID'},{key:'conversion_id',label:'コンバージョンID'},{key:'api_key',label:'APIキー',secret:true},{key:'api_secret',label:'APIシークレット',secret:true},{key:'x_oauth_token',label:'アクセストークン',secret:true},{key:'x_oauth_token_secret',label:'トークンシークレット',secret:true}],
}
export default function AdConnectionDialog({provider,platform,accountId,onClose,onSaved}:{provider:{key:string;label:string};platform?:AdPlatform;accountId:string;onClose:()=>void;onSaved:()=>Promise<void>}) {
 const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries(AD_CONNECTION_FIELDS[provider.key].map(f=>[f.key,f.secret?'':String(platform?.config[f.key]??'')]))), [busy,setBusy]=useState(false),[error,setError]=useState('')
 const persisted=useRef(platform)
 const current=useRef(true)
 useEffect(()=>()=>{current.current=false},[])
 async function connect() {
  if(busy)return
  const fields=AD_CONNECTION_FIELDS[provider.key]
  const existing=persisted.current
  if(fields.some(f=>!values[f.key]?.trim() && !(f.secret && existing?.secretKeys?.includes(f.key)))) {setError('接続に必要な項目を入力してください');return}
  setBusy(true);setError('')
  try {
   const config={...existing?.config,...Object.fromEntries(fields.filter(f=>values[f.key]?.trim()).map(f=>[f.key,values[f.key].trim()]))}
   const saved=existing ? await api.adPlatforms.update(existing.id,{config,isActive:false}) : await api.adPlatforms.create({name:provider.key,displayName:provider.label,lineAccountId:accountId,config})
   if(!saved.success)throw new Error('save')
   persisted.current=saved.data
   const result=await api.adPlatforms.connect(saved.data.id)
   if(!current.current)return
   if(!result.success){setError('接続を確認できませんでした。入力した項目と広告側の権限を確認してください');return}
   await onSaved()
   onClose()
  } catch {if(current.current)setError('接続できませんでした。入力と広告側の権限を確認して、もう一度お試しください')}
  finally {if(current.current)setBusy(false)}
 }
 return <Dialog open busy={busy} title={`${provider.label}をつなぐ`} onCancel={()=>{if(!busy)onClose()}} footer={<><Button disabled={busy} onClick={onClose}>閉じる</Button><Button variant="primary" disabled={busy} onClick={()=>void connect()}>{busy?'確認しています…':'接続を確認してつなぐ'}</Button></>}>
  <p className="mb-4 text-sm">広告側の費用を読み取って接続を確認します。鍵の値は再表示しません。</p>
  <div className="space-y-3">{AD_CONNECTION_FIELDS[provider.key].map(field=><label key={field.key} className="block text-sm"><span>{field.label}</span><TextField aria-label={field.label} type={field.secret?'password':'text'} value={values[field.key]??''} autoComplete={field.secret?'new-password':undefined} placeholder={field.secret&&platform?.secretKeys?.includes(field.key)?'保存済み（空欄なら保持）':''} onChange={e=>setValues(v=>({...v,[field.key]:e.target.value}))}/></label>)}</div>
  {error&&<p role="alert" className="mt-3 text-sm text-status-danger">{error}</p>}
 </Dialog>
}
