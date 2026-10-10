'use client'
import {Tabs} from './tabs'
/** 店舗の絞り込み。配信先のLINE公式アカウント選択とは別の操作。 */
export default function StoreFilterTabs({options,value,onChange,disabled=false}:{options:{value:string;label:string;disabled?:boolean}[];value:string;onChange:(value:string)=>void;disabled?:boolean}) {
 return <Tabs label="店舗で絞り込む" size="compact" wrap items={options.map(option=>({label:option.label.replace(/^店舗[：:]\s*/,''),current:option.value===value,disabled:disabled||option.disabled,onClick:()=>{if(!disabled&&!option.disabled&&option.value!==value)onChange(option.value)}}))}/>
}
