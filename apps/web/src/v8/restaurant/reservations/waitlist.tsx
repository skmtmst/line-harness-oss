'use client'
import {useCallback,useEffect,useState} from 'react'
import Dialog from '@/components/shared/dialog'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import {DataTable,TableHeadRow,Td,Th,Tr} from '@/components/shared/table'
import {restaurantTestApi,type SeatWaitlistEntry} from '@/lib/restaurant-test-api'
import {formatDate} from '@/lib/format'
/** 既存の席の待ちを読む。招待・期限・先着順は共通処理に任せる。 */
export default function SeatWaitlistDialog({accountId,storeId,onClose}:{accountId:string;storeId:string;onClose:()=>void}) {
 const [rows,setRows]=useState<SeatWaitlistEntry[]|null>(null),[error,setError]=useState(''),[cancel,setCancel]=useState<SeatWaitlistEntry|null>(null),[busy,setBusy]=useState(false)
 const load=useCallback(async()=>{try{const response=await restaurantTestApi.listSeatWaitlist(accountId,{storeId});setRows(response.data.waitlist.filter(r=>['waiting','invited'].includes(r.status)));setError('')}catch{setError('キャンセル待ちを読み込めませんでした。')}},[accountId,storeId])
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),30000);return()=>clearInterval(timer)},[load])
 const remove=async()=>{if(!cancel||busy)return;setBusy(true);try{await restaurantTestApi.cancelSeatWaitlist(accountId,cancel.id);setCancel(null);await load()}catch{setError('状態が変わったため取り消せませんでした。');await load()}finally{setBusy(false)}}
 return <><Dialog open title="キャンセル待ち" description="登録の早い順に1組ずつ案内します。仮押さえは30分、2時間前からは10分。1人3件まで、1時間前に受付を締めます。" onCancel={onClose}>
  {error?<Notice tone="danger" message={error}/>:null}
  {!rows?<ListState kind={error?'error':'loading'} onRetry={()=>void load()}/>:rows.length===0?<ListState kind="empty" title="キャンセル待ちはありません"/>:<DataTable><thead><TableHeadRow><Th>日時・お名前</Th><Th>人数</Th><Th>状態</Th><Th>操作</Th></TableHeadRow></thead><tbody>{rows.map(r=><Tr key={r.id}><Td>{formatDate(r.starts_at,{style:'detail'})}<br/>{r.customer_name}</Td><Td>{r.guest_count}名</Td><Td>{r.status==='invited'?`案内中・${formatDate(r.hold_expires_at,{style:'time'})}まで`:'空き待ち'}</Td><Td><Button size="inline" onClick={()=>setCancel(r)}>取り消す</Button></Td></Tr>)}</tbody></DataTable>}
 </Dialog><Dialog open={!!cancel} title="キャンセル待ちを取り消しますか？" description={`${cancel?.customer_name??''}さんの待ちを取り消します。案内中の枠は次の方へ回ります。`} confirmLabel="取り消す" tone="destructive" confirmation busy={busy} onCancel={()=>setCancel(null)} onConfirm={()=>void remove()}/></>
}
