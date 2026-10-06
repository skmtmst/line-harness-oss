'use client'

/*
 * ★V8 バナー生成の小さな窓。共通の窓（Dialog）に絵の幅・上からの位置を渡し、中身だけを絵どおりに組む。
 * - `W7Z57` プロジェクトを作る（名前は必須・100文字まで、説明は任意・500文字まで）
 * - `AnwtH` 画像を取り込む（入れるプロジェクトを選び、PNG・JPEG・WebP、10MB まで）
 * - `I0w2e` アーカイブの確認・`B24oNg` 一覧から外す確認（プロジェクトの中で使う）
 */
import { Archive, ImagePlus, Plus, Upload } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { TextArea, TextField } from '@/components/shared/text-field'
import { api } from '@/lib/api'
import { readFileAsBase64, type BannerProject } from '@/lib/hq-banners'
import BannerDialogFrame from './frame'
import styles from './dialogs.module.css'

/** 取り込める画像（API と同じ）。 */
export const BANNER_UPLOAD_ACCEPT = ['image/png', 'image/jpeg', 'image/webp']
export const BANNER_UPLOAD_MAX_BYTES = 10 * 1024 * 1024

/** 選んだファイルを手元で確かめる。だめなら理由、よければ null。 */
export function uploadRefusal(file: File): string | null {
  if (!BANNER_UPLOAD_ACCEPT.includes(file.type)) return '画像は PNG・JPEG・WebP のみ取り込めます'
  if (file.size > BANNER_UPLOAD_MAX_BYTES) return 'ファイルが大きすぎます（上限 10MB）'
  return null
}

export function CreateProjectDialogV8({ open, project = null, busy, error, onSubmit, onCancel }: {
  open: boolean
  /** 名前と説明を変えるとき。作るときは渡さない。 */
  project?: BannerProject | null
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
    if (!trimmed) return setLocalError('プロジェクト名を入力してください')
    if (trimmed.length > 100) return setLocalError('プロジェクト名は100文字以内で入力してください')
    setLocalError('')
    onSubmit({ name: trimmed, description: description.trim() })
  }

  return (
    <BannerDialogFrame
      open={open}
      kind="create"
      title={project ? '名前と説明を変える' : 'プロジェクトを作る'}
      description={project ? undefined : '案件やキャンペーンごとに作ります。画像はプロジェクトの中で生成・取り込みします。'}
      busy={busy}
      error={localError || error}
      onClose={onCancel}
      designNode="W7Z57"
      actions={(
          <>
            <Button onClick={onCancel} disabled={busy}>キャンセル</Button>
            {/* W7Z57: 名前が空のまま作らせない。 */}
            <Button variant="primary" onClick={submit} disabled={busy || name.trim() === ''} busy={busy} busyLabel="保存しています…">
              {project ? '変更を保存' : <><Plus aria-hidden="true" className={styles.icon} />作って開く</>}
            </Button>
        </>
      )}
    >
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); submit() }}>
          <div className={styles.field}>
            <label htmlFor={`${uid}-name`} className={styles.label}>プロジェクト名</label>
            <TextField
              id={`${uid}-name`}
              value={name}
              maxLength={100}
              autoFocus
              disabled={busy}
              placeholder="例: 春の感謝祭 2周年"
              onChange={(event) => setName(event.target.value)}
              className={styles.full}
            />
          </div>
          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label htmlFor={`${uid}-description`} className={styles.labelSmall}>説明</label>
              <span className={styles.optional}>任意</span>
            </div>
            <TextArea
              id={`${uid}-description`}
              rows={2}
              value={description}
              maxLength={500}
              disabled={busy}
              placeholder="例: 餃子・生ビールのキャンペーン告知"
              onChange={(event) => setDescription(event.target.value)}
              className={`${styles.full} ${styles.textarea}`}
            />
          </div>
        </form>
    </BannerDialogFrame>
  )
}

/**
 * 画像を取り込む（AnwtH）。画像はプロジェクトに属するので、先に入れる先を選ぶ。
 * `projectId` を渡すとそのプロジェクトを最初に選んでおく（プロジェクトの中から開くとき）。
 * 取り込めたら、そのプロジェクトの ID を返す。
 */
export function UploadDialogV8({ open, onClose, onDone, projectId: initialProjectId }: {
  open: boolean
  onClose: () => void
  onDone: (projectId: string) => void
  projectId?: string
}) {
  const uid = useId()
  const [projects, setProjects] = useState<BannerProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // 選んだファイル。選んでから「取り込む」を押すまで送らない。
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    setFile(null)
    setUploading(false)
    void api.hqBanners.projects.list()
      .then((res) => {
        if (cancelled) return
        if (!res.success) throw new Error(res.error)
        setProjects(res.data)
        setProjectId(initialProjectId && res.data.some((p) => p.id === initialProjectId) ? initialProjectId : res.data[0]?.id ?? '')
      })
      .catch(() => { if (!cancelled) setError('プロジェクトを読み込めませんでした。') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, initialProjectId])

  const pickFile = (next: File | undefined) => {
    if (!next) return
    const refusal = uploadRefusal(next)
    if (refusal) return setError(refusal)
    setError('')
    setFile(next)
  }

  const takeIn = async () => {
    if (!file || !projectId || uploading) return
    setUploading(true)
    setError('')
    try {
      const data = await readFileAsBase64(file)
      const res = await api.hqBanners.projects.upload(projectId, { filename: file.name, mimeType: file.type, data })
      if (!res.success) throw new Error(res.error)
      onDone(projectId)
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '画像を取り込めませんでした')
    } finally {
      setUploading(false)
    }
  }

  const noProject = projects.length === 0 && !loading
  return (
    <BannerDialogFrame
      open={open}
      kind="upload"
      title="画像を取り込む"
      description="手持ちの画像をプロジェクトへ入れます。PNG・JPEG・WebP、10MB まで。取り込んだ画像も生成した画像と同じようにアカウントへ渡せます。"
      onClose={onClose}
      busy={uploading}
      error={error || undefined}
      designNode="AnwtH"
      actions={(
          <>
            <Button onClick={onClose} disabled={uploading}>キャンセル</Button>
            <Button variant="primary" onClick={() => void takeIn()} disabled={!file || !projectId || loading || uploading} busy={uploading} busyLabel="取り込み中…">
              <Upload aria-hidden="true" className={styles.icon} />取り込む
            </Button>
        </>
      )}
    >
        {noProject ? (
          <p className={styles.note}>まずプロジェクトを作ってください。画像はプロジェクトの中に入ります。</p>
        ) : (
          <>
            <div className={styles.field}>
              <label htmlFor={`${uid}-project`} className={styles.label}>入れるプロジェクト</label>
              <div className={styles.full}>
                <Select
                  aria-label="入れるプロジェクト"
                  size="full"
                  id={`${uid}-project`}
                  value={projectId}
                  disabled={loading}
                  onChange={setProjectId}
                  options={projects.map((p) => ({ value: p.id, label: p.name }))}
                />
              </div>
            </div>
            <div
              role="button"
              tabIndex={0}
              aria-label="取り込むファイルを選ぶ"
              onClick={() => fileRef.current?.click()}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileRef.current?.click() }}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); pickFile(event.dataTransfer.files?.[0]) }}
              className={dragging ? `${styles.drop} ${styles.dropOn}` : styles.drop}
            >
              <ImagePlus aria-hidden="true" className={styles.dropIcon} />
              {file ? (
                <>
                  <p className={styles.dropText} title={file.name}>{file.name}</p>
                  <span className={styles.dropAgain}>選び直す</span>
                </>
              ) : (
                <>
                  <p className={styles.dropText}>ここへドラッグ、または</p>
                  <Button onClick={(event) => { event.stopPropagation(); fileRef.current?.click() }}>
                    <Upload aria-hidden="true" className={styles.icon} />ファイルを選ぶ
                  </Button>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept={BANNER_UPLOAD_ACCEPT.join(',')}
                className={styles.hiddenInput}
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => { pickFile(event.target.files?.[0]); event.target.value = '' }}
              />
            </div>
          </>
        )}
    </BannerDialogFrame>
  )
}

/**
 * 確かめる窓（I0w2e アーカイブ・B24oNg 一覧から外す）。見出し・説明・区切り線・真ん中にボタン2つ。
 * 危ない操作（一覧から外す）は赤いボタン。
 */
export function BannerConfirmDialogV8({ open, title, description, confirmLabel, tone, busy, error, onConfirm, onCancel, designNode }: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  tone: 'primary' | 'danger'
  busy?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
  designNode: string
}) {
  return (
    <BannerDialogFrame
      open={open}
      kind="confirm"
      title={title}
      description={description}
      onClose={onCancel}
      busy={busy}
      error={error || undefined}
      designNode={designNode}
      role={tone === 'danger' ? 'alertdialog' : 'dialog'}
      actions={(
        <>
          <Button onClick={onCancel} disabled={busy}>キャンセル</Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy} busy={busy} busyLabel="処理中…">
            {tone === 'primary' ? <Archive aria-hidden="true" className={styles.icon} /> : null}{confirmLabel}
          </Button>
        </>
      )}
    />
  )
}
