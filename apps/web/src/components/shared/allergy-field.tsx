'use client'
import { useState } from 'react'
import { allergyValues, DEFAULT_ALLERGY_OPTIONS } from '@line-crm/shared'
import { EntityMultiPickerDialog } from './entity-picker'
import TagPill from './tag-pill'
import Button from './button'
import { TextField } from './text-field'
import styles from './customer-info-panel.module.css'

/** 旧文字値も外せる。窓の取消では確定した値を変えない。 */
export default function AllergyField({ value, options = [...DEFAULT_ALLERGY_OPTIONS], readOnly = false, onChange }: {
  value: string | null; options?: string[]; readOnly?: boolean; onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [other, setOther] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const selected = allergyValues(value)
  const choices = [...new Set([...options, ...selected, ...added])]
  return <div className={styles.allergies}>
    {selected.length ? selected.map(name => <TagPill key={name} name={name} onRemove={readOnly ? undefined : () => onChange(JSON.stringify(selected.filter(item => item !== name)))} />) : <span className={styles.note}>未設定</span>}
    {!readOnly ? <Button size="compact" onClick={() => { setAdded([]); setOther(''); setOpen(true) }}>＋ 足す</Button> : null}
    {open ? <EntityMultiPickerDialog title="アレルギーを選ぶ" items={choices.map(name => ({ id: name, name }))} initialIds={selected} maxSelected={32}
      listFooter={<div className={styles.other}><TextField aria-label="そのほか（自由に書く）" placeholder="例：キウイ" maxLength={100} value={other} onChange={event => setOther(event.target.value)} /><Button disabled={!other.trim()} onClick={() => { setAdded(current => [...current, other.trim()]); setOther('') }}>候補に足す</Button></div>}
      onCancel={() => setOpen(false)} onConfirm={values => { onChange(JSON.stringify(values)); setOpen(false) }} /> : null}
  </div>
}
