'use client'

import { useEffect, useId, useState } from 'react'
import Dialog from '@/components/shared/dialog'
import { TextArea, TextField } from '@/components/shared/text-field'
import type { BannerProject } from '@/lib/hq-banners'

/**
 * プロジェクトを作る／名前と説明を変える。
 *
 * 作るときも名前を先に聞く。バナー生成は「案件ごとのまとまり」が単位なので、
 * 仮名で作って後から直させると、一覧に「新しいプロジェクト 9/12」が並ぶ。
 */
export default function ProjectFormDialog({
  open,
  project,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean
  /** 変えるとき。作るときは null。 */
  project: BannerProject | null
  busy?: boolean
  error?: string
  onSubmit: (input: { name: string; description: string }) => void
  onCancel: () => void
}) {
  const uid = useId()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(project?.name ?? '')
    setDescription(project?.description ?? '')
    setLocalError('')
  }, [open, project])

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setLocalError('プロジェクト名を入力してください')
      return
    }
    if (trimmed.length > 100) {
      setLocalError('プロジェクト名は100文字以内で入力してください')
      return
    }
    setLocalError('')
    onSubmit({ name: trimmed, description: description.trim() })
  }

  return (
    <Dialog
      open={open}
      title={project ? '名前と説明を変える' : 'プロジェクトを作る'}
      description={project ? undefined : '案件やキャンペーンごとに1つ作ります。中で生成した画像は、あとで店舗へ渡せます。'}
      confirmLabel={project ? '変更を保存' : 'プロジェクトを作る'}
      busy={busy}
      error={localError || error}
      onConfirm={submit}
      onCancel={onCancel}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-name`} className="text-label font-bold text-ink">プロジェクト名</label>
          <TextField
            id={`${uid}-name`}
            value={name}
            maxLength={100}
            autoFocus
            disabled={busy}
            placeholder="例: 春の感謝祭 2周年"
            onChange={(event) => setName(event.target.value)}
            className="w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor={`${uid}-description`} className="text-label font-bold text-ink">説明</label>
            <span className="text-micro text-ink-faint">任意</span>
          </div>
          <TextArea
            id={`${uid}-description`}
            rows={2}
            value={description}
            maxLength={500}
            disabled={busy}
            placeholder="例: 餃子・生ビールのキャンペーン告知"
            onChange={(event) => setDescription(event.target.value)}
            className="w-full"
          />
        </div>
      </form>
    </Dialog>
  )
}
