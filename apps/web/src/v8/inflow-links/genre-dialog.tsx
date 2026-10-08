'use client'

/*
 * ★V8 流入と計測のフォルダ（ジャンル）を作る・名前を変える窓。
 * 口と送る形は今の窓（app/inflow-links/_components/create-genre-modal.tsx）と同じ：
 * 作る `api.entryRouteGenres.create(name)`、変える `api.entryRouteGenres.update(id, name)`。
 * 409 は「同じ名前がある」。見た目だけ共通の窓（Dialog）にした。
 */
import { useId, useState } from 'react'
import type { EntryRouteGenre } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Dialog from '@/components/shared/dialog'
import { Field } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import { focusField } from './focus-field'
import { isImeComposing } from '@/components/shared/ime'

export default function GenreDialog({
  genre,
  onClose,
  onSaved,
}: {
  genre: EntryRouteGenre | null
  onClose: () => void
  onSaved: (genre: EntryRouteGenre, previousName: string | null) => void
}) {
  const [name, setName] = useState(genre?.name ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const inputId = useId()

  const save = async () => {
    const normalized = name.trim()
    if (submitting) return
    setError('')
    setNameError('')
    if (!normalized) { setNameError('フォルダ名を入力してください'); focusField(inputId); return }
    setSubmitting(true)
    setError('')
    try {
      const response = genre
        ? await api.entryRouteGenres.update(genre.id, normalized)
        : await api.entryRouteGenres.create(normalized)
      if (!response.success) {
        setSubmitting(false)
        setError(response.error || 'フォルダを保存できませんでした。')
        return
      }
      onSaved(response.data, genre?.name ?? null)
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiError && err.status === 409) {
        setNameError('同じ名前のフォルダが既にあります。')
        focusField(inputId)
      } else setError('フォルダを保存できませんでした。')
    }
  }

  return (
    <Dialog
      open
      title={genre ? 'フォルダ名を変更' : 'フォルダを追加'}
      description="協力会社名や媒体のまとまりなど、流入リンクをまとめる名前を入れてください。消しても、中の経路は未分類に残ります。"
      busy={submitting}
      initialFocusId={nameError ? inputId : undefined}
      error={error || undefined}
      confirmLabel={genre ? '保存する' : 'フォルダを作る'}
      onCancel={onClose}
      onConfirm={() => void save()}
    >
      <Field label="フォルダ名" htmlFor={inputId} error={nameError}>
      <TextField
        id={inputId}
        autoFocus
        value={name}
        onChange={(event) => { setName(event.target.value); setNameError('') }}
        onKeyDown={(event) => {
          // 変換の確定の Enter で書きかけの名前を保存しない。
          if (event.key === 'Enter' && !isImeComposing(event)) void save()
        }}
        maxLength={80}
        placeholder="例: A店"
      />
      </Field>
    </Dialog>
  )
}
