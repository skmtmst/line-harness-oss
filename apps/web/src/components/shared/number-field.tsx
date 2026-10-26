'use client'
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, forwardRef, type ComponentProps, type ReactNode } from 'react'
import { AffixedTextField, TextField } from './text-field'
import { Field } from './form-controls'
import { joinDescribedBy, useFieldContext } from './field-context'
import styles from './number-field.module.css'
export function numberRangeNote(min?: string | number, max?: string | number): string | undefined { return min !== undefined && max !== undefined ? `${min}〜${max}` : undefined }
/** 保存値は変えず、表示だけを3桁で区切る。小数の末尾の0も保つ。 */
export function groupedNumber(value: unknown): string | undefined {
 const raw=String(value ?? '')
 if(!/^-?\d+(?:\.\d+)?$/.test(raw))return undefined
 const [integer,decimal]=raw.split('.')
 return integer.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(decimal===undefined?'':`.${decimal}`)
}
export type NumberFieldProps = ComponentProps<typeof TextField> & {unit?:string;note?:ReactNode;numericText?:boolean;/** 回数・倍率のような短い数。 */short?:boolean}
/** ネイティブの値・入力途中・イベントを保ち、非編集中の表示だけを整える。 */
const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField({unit,note,numericText=false,short=false,min,max,invalid,onFocus,onBlur,onChange,...props},ref){
 const field=useFieldContext(),unitId=useId()
 const [focused,setFocused]=useState(false),[draft,setDraft]=useState(props.defaultValue ?? '')
 const inputRef=useRef<HTMLInputElement>(null)
 const [displayWidth,setDisplayWidth]=useState<number>()
 useLayoutEffect(()=>{
  const input=inputRef.current
  if(!input)return
  const measure=()=>setDisplayWidth(input.getBoundingClientRect().width)
  measure()
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure)
  observer?.observe(input)
  return ()=>observer?.disconnect()
 },[])
 useImperativeHandle(ref,()=>inputRef.current!,[])
 useEffect(()=>{
  const input=inputRef.current,form=input?.form
  if(props.value===undefined&&input)setDraft(input.value)
  const reset=()=>{if(props.value===undefined&&input)setDraft(input.defaultValue)}
  form?.addEventListener('reset',reset)
  return ()=>form?.removeEventListener('reset',reset)
 },[props.defaultValue,props.value])
 const raw=props.value ?? draft,formatted=groupedNumber(raw)
 const overlay=!focused&&formatted!==undefined&&formatted!==String(raw)
 return <Field note={note ?? numberRangeNote(min,max)}>
  <span className={styles.row} data-short={short||undefined} data-number-formatted={overlay||undefined}>
   <AffixedTextField {...props} layout="field" id={props.id ?? field?.controlId} ref={inputRef} type={numericText?'text':'number'} inputMode={props.inputMode ?? (numericText?'decimal':undefined)} min={min} max={max} invalid={invalid || field?.invalid} aria-label={props['aria-label'] ?? field?.label} aria-required={props['aria-required'] ?? (field?.required || undefined)} aria-describedby={joinDescribedBy(props['aria-describedby'],field?.describedBy,unit?unitId:undefined)}
    onFocus={event=>{setFocused(true);onFocus?.(event)}} onBlur={event=>{setFocused(false);onBlur?.(event)}} onChange={event=>{setDraft(event.currentTarget.value);onChange?.(event)}}
    endAdornment={unit?<span id={unitId} className={styles.unit} data-number-unit>{unit}</span>:undefined}/>
   {overlay?<span className={styles.formatted} style={{maxWidth:displayWidth}} aria-hidden="true" data-number-display>{formatted}</span>:null}
  </span>
 </Field>
})
export default NumberField
