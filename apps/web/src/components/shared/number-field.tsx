'use client'
import { forwardRef, type ComponentProps, type ReactNode } from 'react'
import { TextField } from './text-field'
import { Field } from './form-controls'
import { useFieldContext } from './field-context'
import styles from './number-field.module.css'
export function numberRangeNote(min?: string | number, max?: string | number): string | undefined { return min !== undefined && max !== undefined ? `${min}〜${max}` : undefined }
export type NumberFieldProps = ComponentProps<typeof TextField> & {unit?:string;note?:ReactNode;numericText?:boolean}
/** 値と単位を分ける。空欄・0・入力途中をそのまま渡し、数への変換は画面の保存処理が持つ。 */
const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField({unit,note,numericText=false, min,max,invalid,...props},ref){
 const field=useFieldContext()
 return <Field note={note ?? numberRangeNote(min,max)}>
  <span className={styles.row}><TextField {...props} ref={ref} type={numericText?'text':'number'} inputMode={props.inputMode ?? (numericText?'decimal':undefined)} min={min} max={max} invalid={invalid || field?.invalid} aria-label={props['aria-label'] ?? field?.label} aria-required={props['aria-required'] ?? (field?.required || undefined)} aria-describedby={props['aria-describedby'] ?? field?.describedBy}/>{unit?<span className={styles.unit} aria-hidden="true" data-number-unit>{unit}</span>:null}</span>
 </Field>
})
export default NumberField
