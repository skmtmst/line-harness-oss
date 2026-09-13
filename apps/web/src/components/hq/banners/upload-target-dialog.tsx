'use client'

import { Upload } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import SelectField from '@/components/shared/select-field'
import { api } from '@/lib/api'
import type { BannerProject } from '@/lib/hq-banners'
import UploadButton from './upload-button'

/**
 * 画像ライブラリの「画像を取り込む」。Pencil 35-3 `Lveyd`。
 *
 * 画像はプロジェクトに属するので、先にどのプロジェクトへ入れるかを選ぶ。
 * 取り込めたら、そのプロジェクトの詳細へ移る。
 */
export default function UploadTargetDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  /** 取り込みが済んだら、そのプロジェクトIDを返す。 */
  onPick: (projectId: string) => void
}) {
  const uid = useId()
  const [projects, setProjects] = useState<BannerProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    void api.hqBanners.projects
      .list()
      .then((res) => {
        if (cancelled) return
        if (!res.success) throw new Error(res.error)
        setProjects(res.data)
        setProjectId((cur) => cur || res.data[0]?.id || '')
      })
      .catch(() => {
        if (!cancelled) setError('プロジェクトを読み込めませんでした。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <Dialog
      open={open}
      title="画像を取り込む"
      description="手持ちの画像をプロジェクトへ入れます。PNG・JPEG・WebP、10MB まで。取り込んだ画像も生成した画像と同じように店舗へ渡せます。"
      onCancel={onClose}
      error={error || undefined}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button onClick={onClose}>閉じる</Button>
          <UploadButton
            disabled={!projectId || loading}
            onError={setError}
            onUpload={async (input) => {
              const res = await api.hqBanners.projects.upload(projectId, input)
              if (!res.success) throw new Error(res.error)
              onPick(projectId)
            }}
          />
        </div>
      }
    >
      {projects.length === 0 && !loading ? (
        <p className="text-caption text-ink-secondary">まずプロジェクトを作ってください。画像はプロジェクトの中に入ります。</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-project`} className="text-label font-bold text-ink">入れるプロジェクト</label>
          <SelectField
            id={`${uid}-project`}
            className="w-full"
            style={{ width: '100%' }}
            value={projectId}
            disabled={loading}
            onChange={(event) => setProjectId(event.target.value)}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>
      )}
    </Dialog>
  )
}

UploadTargetDialog.Trigger = function UploadTargetTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick}>
      <Upload aria-hidden="true" className="h-4 w-4" />
      画像を取り込む
    </Button>
  )
}
