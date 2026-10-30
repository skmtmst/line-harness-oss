'use client'
import { useEffect, useState } from 'react'
import { INITIAL_MENUS, initialMenuImageDataUri, initialMenuDestination, type AccountStyle, type InitialMenuTarget } from '@line-crm/shared'
import Card, { CardHeader } from '@/components/shared/card'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import EntitySelect from '@/components/shared/entity-select'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import { styleApi } from '@/lib/api/helpers/styles'
import styles from './initial-menu-choice.module.css'

function menuActionDescription(style:AccountStyle,target:InitialMenuTarget):string {
 if(target==='booking')return style==='restaurant'?'席の空きから日時・人数を選ぶ':'空いている日時を選ぶ';
 if(target==='history')return '日時の変更や取り消し';
 if(target==='classes'||target==='schedule')return '開催日と空き状況を見て申し込む';
 if(target==='menu')return style==='restaurant'?'コース・料理・料金のご案内':'メニューと料金のご案内';
 if(target==='access')return '住所・地図・営業時間';
 if(target==='contact')return 'ご相談やお問い合わせを送る';
 if(target==='application')return '必要事項を入力して申し込む';
 if(target==='mypage')return 'ご本人の情報を確認する';
 if(target==='products')return '商品のご案内とお店のストア';
 if(target==='news')return '新しいお知らせを読む';
 if(target==='about')return style==='lesson'?'教室のご案内':'会社のご案内';
 return '使い方やよくある質問を読む';
}

export type InitialMenuSelection = {value:'simple'|'existing'|'later';resourceId?:string}
export function InitialMenuPhone({style}:{style:AccountStyle}) {
 return <LinePreview accountName="お店のLINE" title="お客さまのLINEでの見え方" richMenu={<img className={styles.phoneImage} src={initialMenuImageDataUri(style)} alt={INITIAL_MENUS[style].buttons.map(button=>button.label).join('・')} width={2500} height={1686}/>}><LinePreviewMessage accountName="お店のLINE" avatar={null} time="10:00">友だち追加ありがとうございます。下のメニューからお進みください。</LinePreviewMessage></LinePreview>
}
/** 登録・はじめの質問・設定の選び直しで、同じ4面画像と行き先を使う。 */
export function InitialMenuChoice({accountId,style,value,onChange,disabled=false,disabledReason='保存中は変更できません'}:{accountId:string;style:AccountStyle;value:InitialMenuSelection;onChange:(next:InitialMenuSelection)=>void;disabled?:boolean;disabledReason?:string}) {
 const [resources,setResources]=useState<{accountId:string;items:Array<{id:string;name:string;kind:string}>}|null>(null)
 const [error,setError]=useState<unknown>(null),[tick,setTick]=useState(0)
 useEffect(()=>{
  if(value.value!=='existing')return
  let active=true;setError(null)
  void styleApi.resources(accountId).then(res=>{if(!res.success)throw new Error('メニューを読み込めませんでした');if(active)setResources({accountId,items:res.data.items.filter(item=>item.kind==='rich_menu')})}).catch(error=>{if(active)setError(error)})
  return ()=>{active=false}
 },[accountId,value.value,tick])
 const items=resources?.accountId===accountId?resources.items:null
 const menu=INITIAL_MENUS[style]
 return <>
  <RadioCardGroup legend="使うメニュー" columns={3}>
   <RadioCard name="initial-menu" value="simple" checked={value.value==='simple'} onChange={()=>onChange({value:'simple'})} disabled={disabled} disabledReason={disabledReason} height="fit" title="シンプルなメニュー" note={menu.buttons.map(button=>button.label).join('・')}/>
   <RadioCard name="initial-menu" value="existing" checked={value.value==='existing'} onChange={()=>onChange({value:'existing'})} disabled={disabled} disabledReason={disabledReason} height="fit" title="今あるメニューを使う" note="現在の画像とボタンをそのまま使います"/>
   <RadioCard name="initial-menu" value="later" checked={value.value==='later'} onChange={()=>onChange({value:'later'})} disabled={disabled} disabledReason={disabledReason} height="fit" title="あとで設定する" note="はじめにやることから続けられます"/>
  </RadioCardGroup>
  {value.value==='existing' ? error ? <ListState kind="error" title="メニューを読み込めませんでした" error={error} onRetry={()=>setTick(n=>n+1)}/> : <EntitySelect aria-label="使うリッチメニュー" noun="リッチメニュー" size="full" value={value.resourceId??''} onChange={resourceId=>onChange({value:'existing',resourceId})} disabled={disabled||items===null} disabledReason={disabled?disabledReason:'メニューを読み込んでいます'} options={[{value:'',label:items===null?'読み込んでいます…':items.length?'使うメニューを選ぶ':'使えるメニューがありません'},...(items??[]).map(item=>({value:item.id,label:item.name}))]}/> : null}
  {value.value==='simple' ? <>
   <Card layout="vertical"><CardHeader title="入る画像"/><img className={styles.image} src={initialMenuImageDataUri(style)} alt={menu.buttons.map(button=>button.label).join('・')} width={2500} height={1686}/></Card>
   <CardHeader title="ボタンを押すと開くページ" meta="URLを貼る操作は不要"/>
   <GridTable label="メニューの行き先" design={{columns:'minmax(0,0.85fr) minmax(0,1fr) minmax(0,1.4fr)',gap:'16px',rowHeight:'48px',rowPadding:'0 12px',fontSize:'13px'}}><GridHeadRow><GridCell role="columnheader">ボタン</GridCell><GridCell role="columnheader">開くページ</GridCell><GridCell role="columnheader">できること</GridCell></GridHeadRow>{menu.buttons.map(button=><GridRow key={button.target}><GridCell title={button.label}>{button.label}</GridCell><GridCell title={initialMenuDestination(style,button.target)}>{initialMenuDestination(style,button.target)}</GridCell><GridCell title={menuActionDescription(style,button.target)}>{menuActionDescription(style,button.target)}</GridCell></GridRow>)}</GridTable>
   <Notice tone="info">ページの下書きが入ります。{style==='restaurant'?'席・営業時間と、':''}ページの内容を確認して公開したあと、リッチメニューをLINEに出してください。</Notice>
  </> : null}
 </>
}
