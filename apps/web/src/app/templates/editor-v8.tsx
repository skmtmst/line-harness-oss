'use client'

/*
 * ★V8 テンプレートの作る画面（6種）の共通の器。
 *
 * 型はすべて同じ（Pencil ★V8 u5YC6・J60utH・EFV8l・l87p1J・S6FEuB・EsYo4）:
 * - 上: 「← テンプレートへ」の戻る口と、画面名＋一行の説明
 * - 左: 白いカードの縦積み（名前とフォルダ／中身／…）
 * - 右: 説明のカード（気をつけること 等）＋ 届き方（LinePreview の本物のスマホ）
 * - 下: 追従バー「キャンセル / 下書きを保存 / 保存して公開」
 *
 * 離脱番兵（保存せずに離れますか）はここで受け持つ。各画面は dirty を
 * 渡すだけで、戻る・リンク・タブ終了の3経路が同じ確認を出す。
 */
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import Notice from '@/components/shared/notice'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { usePageTitle } from '@/components/shell/page-chrome'
import styles from './editor-v8.module.css'

/** 左に積む白いカード1枚。題と一行の説明つき。 */
export function EditorCard({
  title,
  note,
  designNode,
  children,
}: {
  title: ReactNode
  note?: ReactNode
  designNode?: string
  children: ReactNode
}) {
  return (
    <section className={styles.card} data-design-node={designNode}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{title}</h2>
        {note ? <p className={styles.cardNote}>{note}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** 右の欄の説明カード。小見出し＋説明の箇条書き。 */
export function GuideCard({
  title,
  items,
  designNode,
}: {
  title: ReactNode
  items: Array<{ term: ReactNode; desc: ReactNode }>
  designNode?: string
}) {
  return (
    <section className={styles.card} data-design-node={designNode}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{title}</h2>
      </div>
      <ul className={styles.guideList}>
        {items.map((item, index) => (
          <li key={index} className={styles.guideItem}>
            <p className={styles.guideTerm}>{item.term}</p>
            <p className={styles.guideDesc}>{item.desc}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

export interface EditorV8Props {
  /** 画面名（「メッセージを作る」など）。 */
  title: string
  /** 画面名の下の一行。 */
  lead?: string
  /** 戻る口の行き先と字。 */
  backHref?: string
  backLabel?: string
  /** Pencil の版印。 */
  designNode?: string
  /** 右の欄で届き方の上に置く説明カード。 */
  guide?: ReactNode
  /** 右の欄の届き方（LinePreview）。 */
  preview?: ReactNode
  /** 左に積むカード群。 */
  children: ReactNode
  /** 未保存の変更があるか。true の間だけ離脱確認が出る。 */
  dirty: boolean
  /** 確認窓で「…が消えます」の主語。 */
  dirtySubject?: string
  /** 保存の進行中（下書きも公開も）。 */
  saving: boolean
  /** 「保存して公開」の進行中だけ立つ。 */
  publishing?: boolean
  /** 追従バーの左の状態文。 */
  status?: ReactNode
  /** 保存を閉じる理由。ある間は両方の保存ボタンを閉じ、理由を title で伝える。 */
  saveBlockedReason?: string | null
  /** 「下書きを保存」。 */
  onSaveDraft: () => void
  /** 「保存して公開」。省略するとボタンごと出ない。 */
  onPublish?: () => void
  publishLabel?: string
  /** エラーの帯（画面の上の方に出す）。文字列か Notice などの部品。 */
  error?: ReactNode
}

export default function EditorV8({
  title,
  lead,
  backHref = '/templates',
  backLabel = 'テンプレートへ',
  designNode,
  guide,
  preview,
  children,
  dirty,
  dirtySubject = '入力した内容',
  saving,
  publishing = false,
  status,
  saveBlockedReason,
  onSaveDraft,
  onPublish,
  publishLabel = '保存して公開',
  error,
}: EditorV8Props) {
  usePageTitle(title)
  /*
   * 「保存せずに離れますか」の番兵。キャンセルのリンク・左メニュー・
   * ブラウザの戻る・タブ終了を全部同じ確認へ通す（共通部品）。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving || publishing })
  const blockedTitle = saveBlockedReason ?? undefined
  return (
    <div className={styles.page} data-design-node={designNode}>
      <header className={styles.head}>
        <Link href={backHref} className={styles.back} data-design-node="Back">
          <ChevronLeft size={16} aria-hidden="true" />
          {backLabel}
        </Link>
        <div>
          <h1 className={styles.headTitle}>{title}</h1>
          {lead ? <p className={styles.headLead}>{lead}</p> : null}
        </div>
      </header>

      {typeof error === 'string' && error ? <Notice tone="danger" message={error} /> : error ? <div role="alert">{error}</div> : null}

      <div className={styles.split}>
        <div className={styles.main}>{children}</div>
        <aside className={styles.aside}>
          {guide}
          {preview}
        </aside>
      </div>

      <StickyBar
        status={status}
        actions={(
          <>
            {/*
              キャンセルは素のリンクのまま。止める役は useUnsavedGuard が
              受け持つ（dirty の間だけ確認窓を出す）。
            */}
            <Button href={backHref} variant="secondary">キャンセル</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onSaveDraft}
              disabled={saving || publishing || Boolean(saveBlockedReason)}
              title={blockedTitle}
              busy={saving && !publishing}
              busyLabel="保存中…"
            >
              下書きを保存
            </Button>
            {onPublish ? (
              <Button
                type="button"
                variant="primary"
                onClick={onPublish}
                disabled={saving || publishing || Boolean(saveBlockedReason)}
                title={blockedTitle}
                busy={publishing}
                busyLabel="公開中…"
              >
                {publishLabel}
              </Button>
            ) : null}
          </>
        )}
      />
      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject={dirtySubject}
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}
