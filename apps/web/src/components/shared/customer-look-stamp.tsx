'use client'
import {useEffect,useState} from 'react'
import type {VisitStampCard} from '@line-crm/shared'
import {visitStampsApi} from '@/lib/visit-stamps-api'
import {ApiError} from '@/lib/api'
import {slotCount,previewSlots} from '@/v8/visit-stamps/public/preview'
import Button from './button'
import EntitySelect from './entity-select'
import styles from './customer-look-preview.module.css'

/** 店の設定だけを読む。お客さまの押印数や残り回数は作らない。 */
export default function CustomerLookStamp({accountId}:{accountId:string|null}) {
 const [cards,setCards]=useState<VisitStampCard[]|null>(null),[error,setError]=useState<unknown>(null),[retry,setRetry]=useState(0),[chosen,setChosen]=useState('')
 useEffect(()=>{
  if(!accountId)return
  let live=true;setCards(null);setError(null);setChosen('')
  visitStampsApi.cards().then(response=>{if(live)setCards(response.data.filter(card=>card.accountIds.includes(accountId)))}).catch(failure=>{if(live)setError(failure)})
  return()=>{live=false}
 },[accountId,retry])
 if(!accountId)return <p>店を選ぶとスタンプカードの見本を確認できます</p>
 if(error)return error instanceof ApiError&&error.status===403?<p>スタンプカードを見る権限がありません</p>:<><p>スタンプカードを読み込めませんでした</p><Button size="compact" onClick={()=>setRetry(n=>n+1)}>もう一度読み込む</Button></>
 if(!cards)return <p>スタンプカードを読み込んでいます</p>
 if(!cards.length)return <p>この店のスタンプカードはまだありません</p>
 const card=cards.length===1?cards[0]:cards.find(item=>item.id===chosen)
 const total=card?slotCount(card.settings):null
 return <>
  {cards.length>1?<EntitySelect noun="スタンプカード" aria-label="見本のスタンプカード" value={chosen} onChange={setChosen} options={cards.map(item=>({value:item.id,label:item.name}))}/>:null}
  {!card?<p>見本にするスタンプカードを選んでください</p>:<>
   <p>{card.name}{card.active?'':'（停止中）'}</p>
   {total!==null&&Number.isSafeInteger(total)&&total>0?<>
    <p>{total}マスのカードの見本です</p>
    <div className={styles.stamps}>{previewSlots(card.settings,0).map(slot=><span key={slot.n} data-stamp-slot={slot.n} title={slot.state==='reward'?'特典':undefined}>{slot.n}</span>)}</div>
    <p>押した数はお客さまごとに異なります</p>
   </>:<p>マス数が未設定です</p>}
  </>}
 </>
}
