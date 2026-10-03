'use client'

/*
 * ★V8-B ウェビナー編集②〜⑤の器。
 *
 * v7 の編集画面（`page.tsx` の EditWebinarPage）とは別の部品として持つ。
 * 戻る・題・手順の帯・段の中身・下の固定帯（キャンセル・下書きを保存・次へ）を
 * 持ち、段ごとの保存は段の部品が引き受ける（保存の登録式）。
 * 未保存のまま離れようとしたら番兵の窓が出る。
 */
import { Suspense, useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { webinarApi, type Webinar, type WebinarCtaCard, type WebinarEditor } from '@/lib/api'
import { STEPS, type StepKey } from './edit-steps'
import VideoStepV8 from './video-v8'
import CtaStepV8 from './cta-v8'
import NotificationsStepV8 from './notifications-v8'
import ReviewStepV8 from './review-v8'
import styles from './edit-v8.module.css'

export type EditV8Pane = StepKey | 'review'

const NEXT_PANE: Record<EditV8Pane, StepKey | 'review' | null> = {
  basic: 'video',
  video: 'cta',
  cta: 'notifications',
  notifications: 'review',
  review: null,
}

const NEXT_LABEL: Record<Exclude<EditV8Pane, 'review'>, string> = {
  basic: '動画へ',
  video: 'CTA・フォームへ',
  cta: '通知へ',
  notifications: '確認へ',
}

const PANE_TITLE: Record<EditV8Pane, string> = {
  basic: '基本設定',
  video: '動画と公開期間',
  cta: 'CTA・フォーム',
  notifications: '通知と視聴後のこと',
  review: '公開の前に確かめる',
}

const PANE_DESC: Record<EditV8Pane, string> = {
  basic: '',
  video: '動画と、見られる期間を決めます。見終わったかどうかの決め方もここで決めます。',
  cta: '動画の途中や終わりに出すカードと、申込に使う回答フォームを決めます。',
  notifications: 'いつ LINE で知らせるかと、見た人・見なかった人に何をするかを決めます。',
  review: 'すべての段がそろうと公開できます。公開すると、申込ページと LINE の案内が使えるようになります。',
}

function StepBand({ current }: { current: StepKey | 'review' }) {
  const order: Array<StepKey | 'review'> = [...STEPS.map((step) => step.key), 'review']
  const currentIndex = order.indexOf(current)
  return (
    <ol className={styles.steps} aria-label="ウェビナー編集の進み方">
      {order.map((key, index) => {
        const step = STEPS.find((item) => item.key === key)
        const title = key === 'review' ? '確認' : step?.title ?? key
        const no = key === 'review' ? '5' : step?.no ?? ''
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo'
        return (
          <li key={key} style={{ display: 'flex', alignItems: 'center' }}>
            <span
              className={`${styles.step} ${state === 'done' ? styles.stepDone : state === 'current' ? styles.stepCurrent : ''}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className={styles.stepNum} aria-hidden="true">{state === 'done' ? '✓' : no}</span>
              {title}
            </span>
            {index < order.length - 1 ? <span className={styles.stepLine} aria-hidden="true" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

export default function EditV8Shell({ webinarId, pane, webinar, editor, registrations, publicUrl, publicPageReason, ctaCount, onWebinarChange, onEditorChange, onCtasReport }: {
  webinarId: string
  pane: EditV8Pane
  webinar: Webinar
  editor: WebinarEditor
  registrations: number | null
  publicUrl: string | null
  publicPageReason: string
  ctaCount: number
  onWebinarChange: (next: Webinar) => void
  onEditorChange: (next: WebinarEditor) => void
  onCtasReport?: (ctas: WebinarCtaCard[] | null) => void
}) {
  const router = useRouter()
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const saveRef = useRef<(() => Promise<boolean>) | null>(null)
  const { leaveTarget, confirmLeave, cancelLeave, disarm } = useUnsavedGuard({ dirty, busy })

  /*
    ★V8-B 競合（板 `pvimJ`）。他の人が先に保存したとき（409）は、
    このまま保存すると相手の変更が消える。帯で止めて、最新を
    読み込んでから続ける。誰が・いつ保存したかは口が返さないので、
    名前と時刻は出さない。
  */
  const reportConflict = useCallback(() => setConflict(true), [])
  const reloadLatest = useCallback(async () => {
    setBusy(true)
    try {
      const [webinarResponse, editorResponse] = await Promise.all([
        webinarApi.get(webinarId),
        webinarApi.editor(webinarId),
      ])
      onWebinarChange(webinarResponse.data)
      onEditorChange(editorResponse.data)
      setConflict(false)
      setDirty(false)
    } finally {
      setBusy(false)
    }
  }, [webinarId, onWebinarChange, onEditorChange])

  const registerSave = useCallback((save: (() => Promise<boolean>) | null) => {
    saveRef.current = save
  }, [])

  const saveDraft = useCallback(async () => {
    if (!saveRef.current) return true
    setBusy(true)
    try {
      const ok = await saveRef.current()
      if (ok) setDirty(false)
      return ok
    } finally {
      setBusy(false)
    }
  }, [])

  const goNext = useCallback(() => {
    const next = NEXT_PANE[pane]
    if (!next) return
    if (dirty) {
      void saveDraft().then((ok) => {
        if (ok) router.push(`/webinars/edit?id=${encodeURIComponent(webinarId)}&pane=${next}`)
      })
    } else {
      router.push(`/webinars/edit?id=${encodeURIComponent(webinarId)}&pane=${next}`)
    }
  }, [dirty, pane, router, saveDraft, webinarId])

  const next = NEXT_PANE[pane]

  /*
    ★V8-B ウェビナーの板。段ごとに外枠へ付ける（進み具合の数え口）。
    動画は中身で分かれる——日時指定の回の一覧が `LPOe7`、いつでも見る形が `VWNaA`。
  */
  const designNode = pane === 'video'
    ? (editor.deliveryKind === 'scheduled' ? 'LPOe7' : 'VWNaA')
    : pane === 'cta' ? 'Q0Jrk'
    : pane === 'notifications' ? 'E7iAYs'
    : 'XCUNf'

  return (
    <div data-design-node={designNode}>
      <Link href="/webinars" className={styles.backLink}>← ウェビナーへ</Link>
      <h1 className={styles.title}>{PANE_TITLE[pane]}</h1>
      <StepBand current={pane} />
      {PANE_DESC[pane] ? <p className={styles.stepDesc}>{PANE_DESC[pane]}</p> : null}
      {conflict ? (
        <Notice tone="warn">
          <p className="font-bold">他の人がこのウェビナーを保存しました</p>
          <p className="mt-1 text-xs">このまま保存すると、その人の変更が消えます。最新を読み込んでから続けてください。</p>
          <span className={styles.conflictActions}>
            <Button disabled={busy} onClick={() => void reloadLatest()} busy={busy} busyLabel="読み込み中…">最新を読み込んで続ける</Button>
          </span>
        </Notice>
      ) : null}
      <div className={styles.body}>
        <Suspense fallback={<ListState kind="loading" />}>
          {pane === 'video' ? (
            <VideoStepV8 webinar={webinar} editor={editor} onWebinarChange={onWebinarChange} onEditorChange={onEditorChange} onDirtyChange={setDirty} registerSave={registerSave} onConflict={reportConflict} />
          ) : pane === 'cta' ? (
            <CtaStepV8 webinar={webinar} editor={editor} accountId={webinar.accountId} onEditorChange={onEditorChange} onCtasReport={onCtasReport} onDirtyChange={setDirty} registerSave={registerSave} onConflict={reportConflict} />
          ) : pane === 'notifications' ? (
            <NotificationsStepV8 webinarId={webinarId} webinarTitle={webinar.title} editor={editor} onEditorChange={onEditorChange} onDirtyChange={setDirty} registerSave={registerSave} onConflict={reportConflict} />
          ) : pane === 'review' ? (
            <ReviewStepV8 webinar={webinar} editor={editor} ctaCount={ctaCount} publicUrl={publicUrl} canOpenPublicPage={webinar.status === 'active' && publicUrl !== null} publicPageReason={publicPageReason} onEditorChange={onEditorChange} onBack={(key) => router.push(`/webinars/edit?id=${encodeURIComponent(webinarId)}&pane=${key}`)} onPublished={disarm} onConflict={reportConflict} />
          ) : null}
        </Suspense>
      </div>
      {pane === 'review' ? null : (
        <StickyBar
          actions={(
            <>
              <Button onClick={() => router.push('/webinars')}>キャンセル</Button>
              <Button disabled={busy} onClick={() => void saveDraft()}>下書きを保存</Button>
              {next ? <Button variant="primary" disabled={busy} onClick={goNext}>→ {NEXT_LABEL[pane as Exclude<EditV8Pane, 'review'>]}</Button> : null}
            </>
          )}
        />
      )}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="編集中のウェビナー" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
