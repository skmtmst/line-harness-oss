'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Check, Search } from 'lucide-react'
import { COMPANY_CONTACT_FIELDS, parseTenantCompanyContact, type TenantCompanyContact } from '@line-crm/shared'
import Button from '@/components/shared/button'
import { Field } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import { SettingsFormCard, SettingsFormRow } from '@/components/shared/settings-form-card'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import { api } from '@/lib/api'
import styles from './settings.module.css'

const EMPTY: TenantCompanyContact = {
  legalCompanyName: null, postalCode: null, address: null, building: null,
  phone: null, contactName: null, contactEmail: null, invoiceAddressee: null,
}
const DESCRIPTION = '請求書・領収書の宛名と、運営からの連絡先に使います。メンバーや友だちには見えません。'
type Candidate = { prefecture: string; city: string; town: string }

/** 管理者だけが呼び出す。通常メンバーには連絡先も読み口も出さない。 */
export default function CompanyContactCard({ canEdit }: { canEdit: boolean }) {
  const uid = useId()
  const [values, setValues] = useState(EMPTY)
  const valuesRef = useRef(values)
  const [revision, setRevision] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [finding, setFinding] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [postalNote, setPostalNote] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const loadSequence = useRef(0)

  const load = async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setError('')
    try {
      const response = await api.tenants.companyContact()
      if (sequence !== loadSequence.current) return
      if (!response.success) throw new Error(response.error)
      const { revision: next, ...data } = response.data
      valuesRef.current = data
      setValues(data)
      setRevision(next)
    } catch (caught) {
      if (sequence !== loadSequence.current) return
      setError(japaneseDetailOf(caught) || describeApiFailure(caught, '会社と連絡先の読み込み'))
    } finally { if (sequence === loadSequence.current) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { loadSequence.current += 1 } }, [])

  const change = (key: keyof TenantCompanyContact, value: string) => {
    valuesRef.current = { ...valuesRef.current, [key]: value }
    setValues(valuesRef.current)
    setSaved(false)
    setError('')
    if (key === 'postalCode') { setCandidates([]); setPostalNote('') }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!canEdit || saving || loading || revision === null) return
    setSaved(false)
    const parsed = parseTenantCompanyContact(values)
    if (parsed.error) { setError(parsed.error); return }
    setSaving(true)
    setError('')
    try {
      const response = await api.tenants.saveCompanyContact({ ...parsed.data!, expectedRevision: revision })
      if (!response.success) throw new Error(response.error)
      const { revision: next, ...data } = response.data
      valuesRef.current = data
      setValues(data)
      setRevision(next)
      setSaved(true)
    } catch (caught) {
      // 通信失敗・権限不足・409でも入力と期待する版をそのまま残す。
      setError(japaneseDetailOf(caught) || describeApiFailure(caught, '会社と連絡先の保存'))
    } finally { setSaving(false) }
  }

  const findAddress = async () => {
    const postal = values.postalCode ?? '', address = values.address
    if (!/^\d{3}-?\d{4}$/.test(postal.trim())) { setPostalNote('郵便番号は7桁で入力してください。'); return }
    setFinding(true)
    setCandidates([])
    setPostalNote('')
    try {
      const response = await api.postalCode.search(postal)
      if (!response.success) throw new Error(response.error)
      // 検索中に番号・住所を編集した場合、遅れた返信で入力を上書きしない。
      if (valuesRef.current.postalCode !== postal || valuesRef.current.address !== address) return
      const found = response.data.candidates
      if (found.length === 1 && !address?.trim()) {
        change('address', `${found[0].prefecture}${found[0].city}${found[0].town}`)
      } else { setCandidates(found) }
      setPostalNote(found.length ? '候補を選ぶと住所へ入ります。番地も入力してください。'
        : response.data.readiness.fullDataset ? '住所が見つかりませんでした。住所を手入力してください。'
        : '郵便番号の全データが未登録です。住所を手入力してください。')
    } catch (caught) {
      if (valuesRef.current.postalCode === postal) setPostalNote(japaneseDetailOf(caught) || describeApiFailure(caught, '住所の検索'))
    } finally { setFinding(false) }
  }

  const field = (key: keyof TenantCompanyContact) => {
    const meta = COMPANY_CONTACT_FIELDS.find(item => item.key === key)!
    return <Field key={key} label={meta.label} htmlFor={`${uid}-${key}`} required={meta.required} optional={!meta.required}>
      <TextField id={`${uid}-${key}`} value={values[key] ?? ''} maxLength={meta.max}
        type={key === 'contactEmail' ? 'email' : key === 'phone' ? 'tel' : 'text'}
        inputMode={key === 'postalCode' ? 'numeric' : undefined}
        placeholder={key === 'building' ? '例：〇〇ビル 5階' : key === 'invoiceAddressee' ? '例：Shed Products株式会社 経理部' : undefined}
        disabled={loading || saving} readOnly={!canEdit} onChange={event => change(key, event.target.value)} />
    </Field>
  }

  return <SettingsFormCard title="会社と連絡先" description={DESCRIPTION} onSubmit={save} noValidate
    actions={canEdit ? <Button variant="primary" type="submit" busy={saving} disabled={loading || finding || revision === null}>
      <Check aria-hidden size={14} />会社と連絡先を保存する</Button> : undefined}>
    {field('legalCompanyName')}
    <SettingsFormRow postal>{field('postalCode')}{canEdit ? <Button type="button" size="field" onClick={() => void findAddress()}
      disabled={loading || saving || finding || revision === null} busy={finding} busyLabel="検索中…"><Search aria-hidden size={14} />住所を探す</Button> : null}</SettingsFormRow>
    {postalNote ? <p role="status" className={styles.hint}>{postalNote}</p> : null}
    {canEdit && candidates.length ? <SettingsFormRow>{candidates.map((candidate, index) => {
      const address = `${candidate.prefecture}${candidate.city}${candidate.town}`
      return <Button key={index} type="button" disabled={saving} onClick={() => { change('address', address); setCandidates([]) }}>{address}</Button>
    })}</SettingsFormRow> : null}
    {field('address')}
    {field('building')}
    <SettingsFormRow>{field('phone')}{field('contactName')}</SettingsFormRow>
    <SettingsFormRow>{field('contactEmail')}{field('invoiceAddressee')}</SettingsFormRow>
    {loading ? <p role="status" className={styles.hint}>読み込んでいます…</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {!loading && revision === null && canEdit ? <Button type="button" onClick={() => void load()}>もう一度読み込む</Button> : null}
    {saved ? <p role="status" className={styles.saved}>会社と連絡先を保存しました。</p> : null}
  </SettingsFormCard>
}
