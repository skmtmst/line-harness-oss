'use client'

import { useId } from 'react'
import { TimeField } from '@/components/shared/date-time-field'
import { Field } from '@/components/shared/form-controls'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'

/** 通常の自動化と共通アクションで同じ待機設定を編集する。 */
export default function WaitFields({ value, onChange, id, error, allowNextDay = false }: {
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  id?: string
  error?: string
  /** 新しい待ち方の選択を許可する。既存設定の編集はこの値に関係なく残す。 */
  allowNextDay?: boolean
}) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const nextDay = value.mode === 'next_day'
  return <>
    {allowNextDay ? <Field label="待ち方" htmlFor={`${fieldId}-mode`} required help="飲食は元の出来事の日、それ以外はルールが動き始めた日の翌日です。飲食は店の時刻、それ以外は日本時間で選びます。処理が遅れても基準日は変わりません。日本時間で予定日のうちは実行し、日付が変わったら期限切れで止めます。">
      <Select id={`${fieldId}-mode`} aria-label="待ち方" value={nextDay ? 'next_day' : 'duration'}
        onChange={mode => onChange(mode === 'next_day' ? { mode, sendAtTime: '10:00' } : { durationMinutes: 5 })}
        options={[{ value: 'duration', label: '決めた時間だけ待つ' }, { value: 'next_day', label: 'きっかけの翌日の時刻まで待つ' }]} />
    </Field> : null}
    {nextDay ? <Field label="翌日の時刻" htmlFor={fieldId} required error={error}>
      <SaveErrorField names={['sendAtTime', 'params.sendAtTime', 'step.params.sendAtTime']}>
        <TimeField id={fieldId} aria-label="翌日の時刻" minuteStep={1} value={String(value.sendAtTime ?? '')}
          onChange={sendAtTime => onChange({ mode: 'next_day', sendAtTime })} invalid={!!error} />
      </SaveErrorField>
    </Field> : <Field label="待つ時間（分・5分単位）" htmlFor={fieldId} required error={error}>
      <SaveErrorField names={['durationMinutes', 'params.durationMinutes', 'step.params.durationMinutes', 'minutes']}>
        <TextField id={fieldId} type="number" min={5} step={5} max={525600}
          value={Number(value.durationMinutes ?? value.minutes ?? 5)} invalid={!!error}
          onChange={event => onChange({ durationMinutes: Number(event.target.value) })} />
      </SaveErrorField>
    </Field>}
  </>
}
