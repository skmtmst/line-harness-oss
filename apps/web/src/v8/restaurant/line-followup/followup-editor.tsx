'use client'
import { useState } from 'react'
import Dialog from '@/components/shared/dialog'
import { DetailColumns } from '@/components/templates/detail-columns'
import { Field } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import Notice from '@/components/shared/notice'
import { FollowupMessageEditor } from './message-editor'
import { FollowupMessageSample } from './message-sample'
import { FollowupTimingFields } from './timing-fields'
import { FOLLOWUP_NAMES,followupTimingError,type FollowupCardModel } from './board-model'
import styles from './board.module.css'
const origins={reservation_created:'予約が完了した人',reservation_24h:'予約が完了した人',reservation_2h:'予約が完了した人',post_visit:'退店した人',review_request:'退店した人',waitlist_invited:'キャンセル待ちで席が空いた人',anniversary_before:'記念日が登録されている人'}
export function FollowupEditor({row,accountId,storeName,onCancel,onConfirm}:{row:FollowupCardModel;accountId:string;storeName:string;onCancel:()=>void;onConfirm:(next:FollowupCardModel)=>void}){
 const [draft,setDraft]=useState(()=>structuredClone(row)),[expanded,setExpanded]=useState(false),[error,setError]=useState('')
 return <Dialog open size="wide" title={`${FOLLOWUP_NAMES[row.trigger]}を変える`} dirty={JSON.stringify(row)!==JSON.stringify(draft)} onCancel={onCancel} confirmLabel="この内容でオンにする" error={error} onConfirm={()=>{
  const timingError=followupTimingError(row.trigger,draft.timing)
  if(timingError){setError(timingError);return}
  if(!draft.bubbles.length||draft.bubbles.some(bubble=>bubble.type==='text'&&!String(bubble.content.text??'').trim())){setError('送る本文を入れるか、テンプレートを選んでください');return}
  onConfirm({...draft,enabled:true})
 }}>
  <DetailColumns asideLabel="届き方" expanded={expanded} onExpandedChange={setExpanded} aside={<FollowupMessageSample bubbles={draft.bubbles} storeName={storeName}/>}>
   <div className={styles.stack}>
    <Field label="だれに（きっかけ）"><TextField readOnly value={origins[row.trigger]}/></Field>
    <FollowupTimingFields trigger={row.trigger} value={draft.timing} onChange={timing=>setDraft({...draft,timing})}/>
    <Field label="送るもの" help="テンプレートなら、リッチメッセージ・カードタイプ・カルーセル・クーポンも選べます。"><FollowupMessageEditor bubbles={draft.bubbles} accountId={accountId} storeName={storeName} onChange={bubbles=>setDraft({...draft,bubbles})}/></Field>
    {row.trigger==='reservation_24h'&&<Notice tone="info">来店の返事のボタンを含めて、吹き出しは5つ以内です。</Notice>}
   </div>
  </DetailColumns>
 </Dialog>
}
