'use client'

import type { ReactNode } from 'react'
import FormSection from '@/components/shared/form-section'
import { SettingsFormRow } from '@/components/shared/settings-form-card'
import { Field } from '@/components/shared/form-controls'
import { TextArea, TextField } from '@/components/shared/text-field'
import NumberInput from '@/components/shared/number-field'
import Select from '@/components/shared/select'
import SegmentedControl from '@/components/shared/segmented'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import type { useFormErrors } from '@/lib/use-form-errors'
import type { CouponDraft } from './coupon-draft'
import styles from './edit.module.css'

export default function CouponSettings({ disabled = false, draft, onChange, title, onTitleChange, fields, image, lottery, onRemoveLottery }: {
  disabled?: boolean; draft: CouponDraft; onChange: (patch: Partial<CouponDraft>) => void
  title: string; onTitleChange: (title: string) => void
  fields: ReturnType<typeof useFormErrors>; image: ReactNode; lottery: boolean; onRemoveLottery: () => void
}) {
  const bind = (key: string) => ({ ...fields.bind(key), invalid: fields.invalid(key) })
  return <>
    <FormSection title="基本設定" id="coupon-basics">
      <SettingsFormRow layout="media-fields">
        {image}
        <div className={styles.couponFields}><fieldset className="contents" disabled={disabled}>
          <Field label="クーポン名" htmlFor="te-coupon-title" requirement={fields.requirement('couponTitle')} error={fields.error('couponTitle')}>
            <SaveErrorField names={['couponTitle', 'title', 'coupon_title']}><TextField {...bind('couponTitle')} id="te-coupon-title" value={title} onChange={event => onTitleChange(event.target.value)} /></SaveErrorField>
          </Field>
          <Field label="獲得条件" error={fields.error('lottery')} help="現在は条件なしで配れます。抽選や友だち紹介の獲得条件には対応していません。">
            <Select aria-label="獲得条件" {...bind('lottery')} value={lottery ? 'lottery' : 'none'} options={[{ value: 'none', label: '条件なし' }, ...(lottery ? [{ value: 'lottery', label: '抽選（保存済み・公開不可）' }] : [])]} onChange={value => { if (value === 'none') onRemoveLottery() }} />
          </Field>
        </fieldset></div>
      </SettingsFormRow>
    </FormSection>
    <fieldset className="contents" disabled={disabled}><FormSection title="特典と利用条件" id="coupon-benefit">
      <SettingsFormRow layout="compact">
        <Field label="クーポンタイプ">
          <SaveErrorField names={['couponType', 'coupon_type']}><Select aria-label="クーポンタイプ" value={draft.couponType} onChange={value => onChange({ couponType: value as CouponDraft['couponType'] })} options={[{ value: 'discount', label: '割引' }, { value: 'none', label: '種類の表示なし' }]} /></SaveErrorField>
        </Field>
        {draft.couponType === 'discount' ? <Field label="割引の表示">
          <SaveErrorField names={['discount']}><Select size="content" aria-label="割引の表示" value={draft.mode} onChange={value => onChange({ mode: value as CouponDraft['mode'] })} options={[{ value: 'amount', label: '円引き' }, { value: 'percent', label: '%引き' }, { value: 'price', label: '割引前・割引後の金額' }, { value: 'none', label: '金額を表示しない' }]} /></SaveErrorField>
        </Field> : null}
      </SettingsFormRow>
      {draft.couponType === 'discount' && draft.mode !== 'none' ? <SettingsFormRow layout="compact">
        {draft.mode === 'amount' ? <Field label="割引額" htmlFor="te-coupon-amount" required error={fields.error('benefit')}>
          <SaveErrorField names={['discount', 'discount.amountYen']}><NumberInput short {...bind('benefit')} id="te-coupon-amount" value={draft.amount} onChange={event => onChange({ amount: event.target.value })} unit="円" min={1} max={9999999} /></SaveErrorField>
        </Field> : draft.mode === 'percent' ? <Field label="割引率" htmlFor="te-coupon-percent" required error={fields.error('benefit')}>
          <SaveErrorField names={['discount', 'discount.percent']}><NumberInput short {...bind('benefit')} id="te-coupon-percent" value={draft.percent} onChange={event => onChange({ percent: event.target.value })} unit="%" min={1} max={99} /></SaveErrorField>
        </Field> : <>
          <Field label="割引前の金額" htmlFor="te-coupon-before" required error={fields.error('benefit')}><SaveErrorField names={['discount', 'discount.beforeYen']}><NumberInput short {...bind('benefit')} id="te-coupon-before" value={draft.before} onChange={event => onChange({ before: event.target.value })} unit="円" min={1} max={9999999} /></SaveErrorField></Field>
          <Field label="割引後の金額" htmlFor="te-coupon-after" required><SaveErrorField names={['discount', 'discount.afterYen']}><NumberInput short {...bind('benefit')} id="te-coupon-after" value={draft.after} onChange={event => onChange({ after: event.target.value })} unit="円" min={0} max={9999999} /></SaveErrorField></Field>
        </>}
      </SettingsFormRow> : null}
      <Field label="利用条件" htmlFor="te-coupon-conditions" count={{ value: draft.conditions.length, max: 30 }} error={fields.error('conditions')}>
        <SaveErrorField names={['conditions']}><TextField {...bind('conditions')} id="te-coupon-conditions" value={draft.conditions} onChange={event => onChange({ conditions: event.target.value })} placeholder="例：1,000円以上のお支払いで利用可能" /></SaveErrorField>
      </Field>
      <SettingsFormRow layout="compact">
        <Field label="クーポンコード">
          <SegmentedControl aria-label="クーポンコードの表示" value={draft.showCode ? 'show' : 'hide'} onChange={value => onChange({ showCode: value === 'show' })} options={[{ value: 'hide', label: '表示しない' }, { value: 'show', label: '表示する' }]} />
        </Field>
        {draft.showCode ? <Field label="表示するコード" htmlFor="te-coupon-code" required error={fields.error('code')}>
          <SaveErrorField names={['code', 'code.text']}><TextField {...bind('code')} id="te-coupon-code" value={draft.code} onChange={event => onChange({ code: event.target.value })} /></SaveErrorField>
        </Field> : null}
      </SettingsFormRow>
    </FormSection></fieldset>

  </>
}

export function CouponGuide({ draft, onChange, fields }: {
  draft: CouponDraft; onChange: (patch: Partial<CouponDraft>) => void; fields: ReturnType<typeof useFormErrors>
}) {
  const bind = (key: string) => ({ ...fields.bind(key), invalid: fields.invalid(key) })
  return (
    <FormSection title="利用ガイド" id="coupon-guide">
      <Field label="使うときの説明" htmlFor="te-coupon-desc" required count={{ value: draft.instructions.length, max: 500 }} error={fields.error('instructions')}>
        <SaveErrorField names={['instructions', 'description']}><TextArea {...bind('instructions')} id="te-coupon-desc" rows={4} value={draft.instructions} onChange={event => onChange({ instructions: event.target.value })} /></SaveErrorField>
      </Field>
    </FormSection>
  )
}
