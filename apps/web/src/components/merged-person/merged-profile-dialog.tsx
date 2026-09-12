'use client'

import React from 'react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import { Field } from '@/components/shared/form-controls'
import SelectField from '@/components/shared/select-field'
import type { FriendProfileCandidate } from '@/lib/api'

export type ProfileCandidateDraft = Record<string, {
  optionIndex: string
  updateMode: 'auto' | 'fixed'
}>

export function emptyProfileCandidateDraft(
  candidates: FriendProfileCandidate[],
): ProfileCandidateDraft {
  return Object.fromEntries(candidates.map((field) => [
    field.fieldKey,
    { optionIndex: '', updateMode: 'fixed' as const },
  ]))
}

export function selectedProfileCandidateCount(
  candidates: FriendProfileCandidate[],
  draft: ProfileCandidateDraft,
): number {
  return candidates.filter((field) => {
    const optionIndex = draft[field.fieldKey]?.optionIndex
    const index = Number(optionIndex)
    return optionIndex !== ''
      && Number.isInteger(index)
      && index >= 0
      && typeof field.options[index]?.candidateId === 'string'
  }).length
}

export default function MergedProfileDialog({
  open,
  candidates,
  draft,
  revision,
  busy,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  open: boolean
  candidates: FriendProfileCandidate[]
  draft: ProfileCandidateDraft
  revision: number
  busy: boolean
  error?: string
  onChange: (next: ProfileCandidateDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const selectedCount = selectedProfileCandidateCount(candidates, draft)
  return (
    <Dialog
      open={open}
      title="統合プロフィールを編集"
      description="項目ごとに採用する値と、その後の更新方法を選びます。画面にはマスク済みの値だけを表示します。"
      busy={busy}
      error={error}
      onCancel={onCancel}
      designNode="w8W4Eh"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" onClick={onCancel} disabled={busy}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={onSave} disabled={busy || selectedCount === 0}>
            {busy ? '保存中…' : `選んだ${selectedCount}項目を保存`}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-3">
        <p className="rounded-control bg-canvas-sunken px-3 py-2 text-xs leading-5 text-ink-secondary">
          読み込んだのは第{revision}版です。先に別の人が変更した場合は上書きしません。
        </p>
        {candidates.length === 0 ? (
          <p className="text-xs leading-5 text-ink-faint">採用する値の候補はまだありません。</p>
        ) : candidates.map((field) => {
          const row = draft[field.fieldKey] ?? { optionIndex: '', updateMode: 'fixed' as const }
          return (
            <Card key={field.fieldKey} padding="default">
              <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
                <p className="text-sm font-bold leading-5 text-ink">{field.fieldLabel}</p>
                <Field label="採用する値">
                  <SelectField
                    className="w-full"
                    aria-label={`${field.fieldLabel}の採用値`}
                    value={row.optionIndex}
                    onChange={(event) => onChange({
                      ...draft,
                      [field.fieldKey]: { ...row, optionIndex: event.target.value },
                    })}
                    options={[
                      { value: '', label: '変更しない' },
                      ...field.options.map((option, index) => ({
                        value: String(index),
                        label: `${option.valuePreview ?? '値は未取得'} ／ ${option.sourceLabel}`,
                      })),
                    ]}
                  />
                </Field>
                <Field label="これからの更新">
                  <SelectField
                    className="w-full"
                    aria-label={`${field.fieldLabel}の更新方法`}
                    value={row.updateMode}
                    disabled={row.optionIndex === ''}
                    onChange={(event) => onChange({
                      ...draft,
                      [field.fieldKey]: {
                        ...row,
                        updateMode: event.target.value as 'auto' | 'fixed',
                      },
                    })}
                    options={[
                      { value: 'fixed', label: 'この値で固定' },
                      { value: 'auto', label: '同じ取得元の新しい値で更新' },
                    ]}
                  />
                </Field>
              </div>
            </Card>
          )
        })}
      </div>
    </Dialog>
  )
}
