'use client'
import {CUSTOMER_DESIGNS, type CustomerDesignPreset} from '@line-crm/shared'
import RadioCard, {RadioCardGroup} from './radio-card'
import styles from './customer-design-picker.module.css'
export default function CustomerDesignPicker({value,onChange,columns=3,readOnly=false}: {value:CustomerDesignPreset;onChange:(value:CustomerDesignPreset)=>void;columns?:2|3;readOnly?:boolean}) {
 const choices=[...CUSTOMER_DESIGNS,{...CUSTOMER_DESIGNS[4],id:'custom' as const,label:'カスタム',note:'色と書体を自分で決める'}]
 if (readOnly) return <p>{choices.find(choice=>choice.id===value)?.label}</p>
 return <RadioCardGroup legend="デザインの型" className={columns===2?styles.two:styles.three}>
  {choices.map(choice=><RadioCard key={choice.id} name="customer-design-preset" value={choice.id} checked={value===choice.id} onChange={next=>onChange(next as CustomerDesignPreset)} title={choice.label} note={choice.note}
    icon={<span className={styles.swatches}>{[choice.background,choice.main,choice.sub,choice.text].map((color,i)=><span key={i} style={{backgroundColor:color}}/>)}</span>}/>)}
 </RadioCardGroup>
}
