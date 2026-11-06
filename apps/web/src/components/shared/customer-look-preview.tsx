'use client'
import {useEffect,useState, type CSSProperties} from 'react'
import {customerPalette,DEFAULT_CUSTOMER_LOOK,emptyLayout,type CustomerLook} from '@line-crm/shared'
import LiffPhoneFrame from './liff-phone-frame'
import {Tabs} from './tabs'
import bookingPhone from '@/v8/booking-menus/settings.module.css'
import { FormPhone } from '@/v8/form-edit/public/phone/index'
import Card from './card'
import styles from './customer-look-preview.module.css'
import {customerBookingSample} from './customer-look-booking'
import CustomerLookStamp from './customer-look-stamp'
export default function CustomerLookPreview({look,accountName,accountId=null}: {look:CustomerLook;accountName:string;accountId?:string|null}) {
 const [page,setPage]=useState('booking'); const palette=customerPalette(look)
 const [bookingSample,setBookingSample]=useState<ReturnType<typeof customerBookingSample>|null>(null)
 useEffect(()=>setBookingSample(customerBookingSample(new Date())),[])
 const bookingSummary=bookingSample?.summary
 const layout=emptyLayout();layout.options.customerDesign={mode:'account',preset:'line'};layout.sections[0].blocks=[
  {id:'title',kind:'heading',text:'ご来店のアンケート',level:1},
  {id:'rating',kind:'input',type:'rating',name:'rating',label:'満足度',rating:{max:5}},
  {id:'good',kind:'input',type:'checkbox',name:'good',label:'よかったところ（いくつでも）',choices:[{id:'1',label:'仕上がり'},{id:'2',label:'スタッフの対応'},{id:'3',label:'待ち時間'}]},
  {id:'note',kind:'input',type:'textarea',name:'note',label:'ひとこと',placeholder:'耳そうじもしてもらえて…'},
 ] as never
 const vars={'--color-canvas':palette.background,'--color-ink':palette.text,'--customer-primary':palette.main,'--customer-background':palette.background,'--customer-font':palette.font==='mincho'?'serif':'sans-serif'} as CSSProperties
 return <div className={styles.preview}>
  <h3 className={styles.title}>お客さまの見え方</h3>
  <Tabs size="compact" label="見本の画面" items={[['booking','予約'],['form','回答フォーム'],['history','予約の履歴'],['stamp','来店スタンプ']].map(([key,label])=>({label,current:page===key,onClick:()=>setPage(key)}))}/>
  <div style={vars}>{page==='form'?<FormPhone layout={layout} accountLook={look} pageIndex={0} accountName={accountName} bookingMenus={[]} caption={null}/>:
   <LiffPhoneFrame accountName={accountName} accent={palette.main} title={page==='history'?'予約の履歴':page==='stamp'?'来店スタンプ':'ご予約'} label="お客さまの画面の見本">
    <div className={styles.content}>
     {page==='booking'?(bookingSample?<><div className={`${bookingPhone.phoneViewSwitch} ${styles.viewSwitch}`} aria-hidden="true"><span className={`${bookingPhone.phoneViewItem} ${bookingPhone.phoneViewItemNow} ${styles.viewNow}`}>週で見る</span><span className={bookingPhone.phoneViewItem}>月で見る</span></div><h2>ご希望の日時</h2><p>〈　{bookingSample.range}　〉</p><div className={styles.week}>{bookingSample.days.map(({key,day,date})=><span key={key} data-date={key} data-selected={key===bookingSample.selectedDate || undefined}>{day}<strong>{date}</strong>・</span>)}</div><div className={styles.times}>{['9:00','10:00','13:00','14:00','15:00','16:00'].map(time=><span key={time} data-selected={time===bookingSample.time||undefined}>{time}</span>)}</div><div className={styles.footer}><p>{bookingSummary}</p><span className={styles.primary}>内容を確かめる</span></div></>:<p>暦を読み込んでいます</p>):
      page==='history'?<><h2>予約の履歴</h2><Card as="article" className={styles.sample} padding="default" gap="tight"><strong>{bookingSummary}</strong><p>トリミング</p><p>予約が確定しています</p><span className={styles.primary}>予約の内容を見る</span></Card></>:
      <><h2>来店スタンプ</h2><CustomerLookStamp key={accountId??'none'} accountId={accountId}/></>}
    </div>
   </LiffPhoneFrame>}</div>
 </div>
}
