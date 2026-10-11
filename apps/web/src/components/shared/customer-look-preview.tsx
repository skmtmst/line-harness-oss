'use client'
import {useState, type CSSProperties} from 'react'
import {customerPalette,DEFAULT_CUSTOMER_LOOK,emptyLayout,type CustomerLook} from '@line-crm/shared'
import LiffPhoneFrame from './liff-phone-frame'
import {Tabs} from './tabs'
import {FormPhone} from '@/v8/form-edit/phone'
import styles from './customer-look-preview.module.css'
export default function CustomerLookPreview({look,accountName}: {look:CustomerLook;accountName:string}) {
 const [page,setPage]=useState('booking'); const palette=customerPalette(look)
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
  <div style={vars}>{page==='form'?<FormPhone layout={layout} accountLook={look} pageIndex={0} accountName={accountName} bookingMenus={[]}/>:
   <LiffPhoneFrame accountName={accountName} accent={palette.main} title={page==='history'?'予約の履歴':page==='stamp'?'来店スタンプ':'ご予約'} label="お客さまの画面の見本">
    <div className={styles.content}>
     {page==='booking'?<><div className={styles.segment}>週で見る　　月で見る</div><h2>ご希望の日時</h2><p>〈　10月 第1週　〉</p><div className={styles.week}>{['日','月','火','水','木','金','土'].map((day,i)=><span key={day} data-selected={i===5 || undefined}>{day}<strong>{i+1}</strong>・</span>)}</div><div className={styles.times}>{['9:00','10:00','13:00','14:00','15:00','16:00'].map(time=><span key={time} data-selected={time==='13:00'||undefined}>{time}</span>)}</div><div className={styles.footer}><p>10月2日（金）13:00</p><span className={styles.primary}>内容を確かめる</span></div></>:
      page==='history'?<><h2>予約の履歴</h2><div className={styles.sample}><strong>10月2日（金）13:00</strong><p>トリミング</p><p>予約が確定しています</p><span className={styles.primary}>予約の内容を見る</span></div></>:
      <><h2>来店スタンプ</h2><p>あと2回のご来店で特典を受け取れます</p><div className={styles.stamps}>{Array.from({length:5},(_,i)=><span key={i} data-selected={i<3 || undefined}>{i<3?'✓':i+1}</span>)}</div><span className={styles.primary}>特典を見る</span></>}
    </div>
   </LiffPhoneFrame>}</div>
 </div>
}
