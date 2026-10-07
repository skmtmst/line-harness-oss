'use client'

/*
 * ★V8-B コラムを書く（`yRDwW`）。
 *
 * 下書きの決めごと（validateDraft・canSubmit・toCreateInput・failureOf）は今の画面と同じ
 * （column-form.ts に写して持つ）。違いは置き場と見せ方だけ——
 * ・節は 題名と分類・記事のリンク・届く形・いつだれに出しますか・読んだ人にすること。
 * ・右に LINE での見え方・読まれるコラムの書きかた・この画面でできないこと。
 * ・配信対象は「友だち全員」と「タグで絞る：〇〇」を1つの選ぶ欄で選ぶ。
 * ・絵に無いが機能がある欄（公開日時・届く人数・題名の長さの知らせ）は、欄の横に小さく置き、
 *   開いたとき・知らせが要るときだけ場所を取る。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Eye, Image as ImageIcon, Save, Type } from 'lucide-react'
import type { Tag } from '@line-crm/shared'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import DateTimeField from '@/components/shared/date-time-field'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import RadioCard from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { formatNumber } from '@/lib/format'
import {
  CATEGORY_MAX,
  EMPTY_DRAFT,
  EXCERPT_MAX,
  TITLE_MAX,
  TITLE_NOTICE_LENGTH,
  canSubmit,
  failureOf,
  toCreateInput,
  titleNotice,
  validateDraft,
  visibleAccountTags,
  type ColumnDraft,
  type Failure,
} from './column-form'
import styles from './form.module.css'

/** 配信対象の選ぶ欄の値。全員は 'all'、タグは 'tag:<id>'。 */
function targetValue(draft: ColumnDraft): string {
  return draft.targetMode === 'tag' ? `tag:${draft.targetTagId}` : 'all'
}

export default function ColumnNew() {
  const router = useRouter()
  const { selectedAccountId, selectedAccount } = useAccount()
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)
  const [draft, setDraft] = useState<ColumnDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [touched, setTouched] = useState(false)
  const [tags, setTags] = useState<Tag[]>([])
  const [audienceCount, setAudienceCount] = useState<number | null>(null)
  const [tagPruneNotice, setTagPruneNotice] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  useEffect(() => {
    void api.tags.list(selectedAccountId ? { accountId: selectedAccountId } : undefined)
      .then((response) => response.success && setTags(response.data)).catch(() => undefined)
  }, [selectedAccountId])
  // アカウントを替えて、選んでいたタグが今のアカウントに無くなったら外して知らせる。
  useEffect(() => {
    if (draft.targetMode !== 'tag' || !draft.targetTagId) return
    if (!tags.some((tag) => tag.id === draft.targetTagId)) {
      setDraft((current) => ({ ...current, targetTagId: '' }))
      setTagPruneNotice('選んでいたタグは、今のアカウントにないため外しました。選び直してください。')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags])
  useEffect(() => {
    if (!selectedAccountId || (draft.targetMode === 'tag' && !draft.targetTagId)) {
      setAudienceCount(null)
      return
    }
    void api.nenCampaigns.columnAudience(selectedAccountId, draft.targetMode, draft.targetTagId || null)
      .then((response) => setAudienceCount(response.success ? response.data.count : null))
      .catch(() => setAudienceCount(null))
  }, [draft.targetMode, draft.targetTagId, selectedAccountId])

  const back = <Link href="/nen-campaigns?tab=columns" className={styles.backLink}><ChevronLeft size={14} aria-hidden="true" />NEN配信へ</Link>

  if (!selectedAccountId) {
    return (
      <ListState
        kind="empty"
        title="LINEアカウントが選ばれていません"
        description="コラムはアカウントごとに保存します。上のLINEアカウントを選んでください。"
      />
    )
  }

  // 書けるのは管理できる人だけ。見るだけの人には押せない物を置かず、一覧へ戻る道だけ出す。
  if (!canEdit) {
    return (
      <CreatePage
        boardId="yRDwW"
        title="コラムを書く"
        description="外部サイトの記事へつなぐ下書きを作ります。記事本文は外部サイトで管理します。"
        identity={back}
        footerActions={<Button href="/nen-campaigns?tab=columns">一覧へ戻る</Button>}
      >
        <div className={styles.viewerBand} role="status">
          <Eye size={16} aria-hidden="true" />
          <span>閲覧のみで見ています。コラムを書くのは管理者に頼んでください。</span>
        </div>
      </CreatePage>
    )
  }

  const errors = validateDraft(draft)
  const errorFor = (field: keyof ColumnDraft) => (touched ? errors.find((e) => e.field === field)?.message : undefined)
  const accountTags = visibleAccountTags(tags, selectedAccountId)
  const set = (patch: Partial<ColumnDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const hasImage = draft.imageUrl.trim() !== ''
  const longTitle = draft.title.trim().length > TITLE_NOTICE_LENGTH ? titleNotice(draft.title) : null

  const save = async () => {
    setTouched(true)
    if (!canSubmit({ draft, busy })) return
    setBusy(true)
    setFailure(null)
    try {
      const res = await api.nenCampaigns.createColumn(selectedAccountId, toCreateInput(draft))
      if (!res.success) throw new Error('failed')
      router.push('/nen-campaigns?tab=columns')
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined
      const code = e instanceof ApiError ? e.code : undefined
      setFailure(failureOf({ status, code }))
    } finally {
      setBusy(false)
    }
  }

  const title = draft.title.trim() || '（題名がまだありません）'
  const excerpt = draft.excerpt.trim() || '（概要がまだありません）'
  const accountName = selectedAccount?.displayName || selectedAccount?.name || '公式アカウント'
  const preview = (
    <div className={styles.side}>
      <LinePreview accountName={accountName} caption={draft.scheduledAt ? draft.scheduledAt.replace('T', ' ').replaceAll('-', '/') : '配信日時は未設定'}>
        <LinePreviewMessage accountName={accountName} avatar={accountName.slice(0, 1)} time="10:00">
          <span className={styles.bubbleText}>{`【コラム】${title}\n${excerpt}\n▶ コラムを読む`}</span>
        </LinePreviewMessage>
      </LinePreview>
      <section className={styles.sideCard} aria-labelledby="nen-col-tips">
        <h2 className={styles.sideTitle} id="nen-col-tips">読まれるコラムの書きかた</h2>
        <ul className={styles.sideText}>
          <li>・相談の言葉から始める</li>
          <li>・売り込みを入れない</li>
          <li>・差し込む言葉（お名前・ペット名）は1つまで</li>
        </ul>
      </section>
      <section className={styles.sideCard} aria-labelledby="nen-col-cannot">
        <h2 className={styles.sideTitle} id="nen-col-cannot">この画面でできないこと</h2>
        <p className={`${styles.sideText} ${styles.sideTextTight}`}>記事の本文を書く（外部サイトで書きます）・出しかたの細かい設定（一斉配信と同じ）</p>
      </section>
    </div>
  )

  return (
    <CreatePage
      boardId="yRDwW"
      title="コラムを書く"
      description="外部サイトの記事へつなぐ下書きを作ります。記事本文は外部サイトで管理します。"
      identity={back}
      preview={preview}
      status={canSubmit({ draft, busy }) ? 'まだ保存していません。保存すると下書きとして一覧に並びます。' : '題名と記事のURLを入れると保存できます。'}
      footerActions={(
        <>
          <Button href="/nen-campaigns?tab=columns">キャンセル</Button>
          <Button type="button" variant="primary" disabled={busy} busy={busy} busyLabel="保存しています…" onClick={() => void save()}>
            <Save size={15} aria-hidden="true" />下書きを保存
          </Button>
        </>
      )}
    >
      {failure ? <Notice tone="danger" message={failure.message} data-failure-kind={failure.kind} /> : null}
      {tagPruneNotice ? <Notice tone="warn" message={tagPruneNotice} onClose={() => setTagPruneNotice(null)} /> : null}

      <section className={`${styles.card} ${styles.cardWide}`} aria-labelledby="nen-col-title" data-nen-part="title">
        <h2 className={`${styles.cardTitle} ${styles.cardTitleLarge}`} id="nen-col-title">題名と分類</h2>
        <label className={styles.field}>
          <span className={styles.labelRow}>
            <span className={styles.label}>題名</span>
            {longTitle ? <span className={styles.labelNote} title={longTitle}>{longTitle}</span> : null}
          </span>
          <TextField aria-label="題名" value={draft.title} maxLength={TITLE_MAX} placeholder={`LINE の通知には${TITLE_NOTICE_LENGTH}文字まで出ます`} invalid={Boolean(errorFor('title'))} onChange={(event) => set({ title: event.target.value })} />
          {errorFor('title') ? <span className={styles.error} role="alert">{errorFor('title')}</span> : null}
        </label>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>分類</span>
            <TextField aria-label="分類" value={draft.category} maxLength={CATEGORY_MAX} placeholder="例: 季節のこと" onChange={(event) => set({ category: event.target.value })} />
          </label>
          <div className={styles.field}>
            <span className={styles.labelSmall}>前のコラムを下敷きにする</span>
            <Link href="/nen-campaigns?tab=columns" className={styles.linkAction}>一覧で元のコラムを選びます →</Link>
          </div>
        </div>
        <label className={styles.field}>
          <span className={styles.label}>概要（LINE のカードに出る短い紹介文）</span>
          <TextField aria-label="概要" value={draft.excerpt} maxLength={EXCERPT_MAX} onChange={(event) => set({ excerpt: event.target.value })} />
        </label>
      </section>

      <section className={`${styles.card} ${styles.cardWide}`} aria-labelledby="nen-col-link" data-nen-part="article">
        <h2 className={`${styles.cardTitle} ${styles.cardTitleLarge}`} id="nen-col-link">記事のリンク</h2>
        <label className={styles.field}>
          <span className={styles.label}>記事の URL</span>
          <TextField aria-label="記事の URL" value={draft.articleUrl} placeholder="https://example.com/columns/..." invalid={Boolean(errorFor('articleUrl'))} onChange={(event) => set({ articleUrl: event.target.value })} />
          {errorFor('articleUrl') ? <span className={styles.error} role="alert">{errorFor('articleUrl')}</span> : null}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>画像の URL</span>
          <TextField id="nen-col-image" aria-label="画像の URL" value={draft.imageUrl} placeholder="https://cdn.example.com/..." invalid={Boolean(errorFor('imageUrl'))} onChange={(event) => set({ imageUrl: event.target.value })} />
          {errorFor('imageUrl') ? <span className={styles.error} role="alert">{errorFor('imageUrl')}</span> : null}
        </label>
      </section>

      <section className={`${styles.card} ${styles.cardWide}`} aria-labelledby="nen-col-kind">
        <h2 className={`${styles.cardTitle} ${styles.cardTitleLarge}`} id="nen-col-kind">届く形</h2>
        {/* 届く形は画像の URL で決まる（写真つき＝画像あり、文字だけ＝画像なし）。文字だけを選ぶと画像の URL を外し、写真つきを選ぶと画像の URL の欄へ移る。 */}
        <div className={styles.pickRow} role="radiogroup" aria-label="届く形">
          <RadioCard name="column-kind" value="card" checked={hasImage} onChange={() => { if (!hasImage) document.getElementById('nen-col-image')?.focus() }} icon={<ImageIcon size={16} aria-hidden="true" />} title="上の写真＋コラムを読む" note={hasImage ? '写真の下に題名とボタン' : '画像の URL を入れると選べます'} />
          <RadioCard name="column-kind" value="text" checked={!hasImage} onChange={() => set({ imageUrl: '' })} icon={<Type size={16} aria-hidden="true" />} title="文字だけ" note="題名と概要とリンク" />
        </div>
      </section>

      <section className={`${styles.card} ${styles.cardWide}`} aria-labelledby="nen-col-when" data-nen-part="publish">
        <div className={styles.cardHead}>
          <h2 className={`${styles.cardTitle} ${styles.cardTitleLarge}`} id="nen-col-when">いつ・だれに出しますか</h2>
          <p className={`${styles.cardNote} ${styles.cardNoteDark}`}>この日時は下書きに記録されます。実際の配信は、一覧で「この内容で予約する」を押したときだけ始まります</p>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <span className={styles.labelRow}>
              <label className={styles.label} htmlFor="nen-schedule-v8">配信日時（日本時間）</label>
              <button type="button" className={styles.labelAside} aria-expanded={publishOpen} onClick={() => setPublishOpen((current) => !current)}>{publishOpen ? '公開日時を閉じる' : '公開日時も記録する'}</button>
            </span>
            <DateTimeField id="nen-schedule-v8" aria-label="配信日時（日本時間）" value={draft.scheduledAt} invalid={Boolean(errorFor('scheduledAt'))} onChange={(value) => set({ scheduledAt: value })} />
            {errorFor('scheduledAt') ? <span className={styles.error} role="alert">{errorFor('scheduledAt')}</span> : null}
          </div>
          <div className={styles.field}>
            <span className={styles.labelRow}>
              <span className={styles.labelSmall}>配信対象</span>
              <span className={styles.labelNote}>{audienceCount == null ? '' : `${formatNumber(audienceCount)}人に届きます`}</span>
            </span>
            <Select
              aria-label="配信対象"
              size="full"
              value={targetValue(draft)}
              error={errorFor('targetTagId')}
              options={[
                { value: 'all', label: '友だち全員' },
                ...(draft.targetMode === 'tag' && !draft.targetTagId ? [{ value: 'tag:', label: 'タグで絞る：タグを選んでください' }] : []),
                ...accountTags.map((tag) => ({ value: `tag:${tag.id}`, label: `タグで絞る：${tag.name}` })),
              ]}
              onChange={(value) => set(value === 'all' ? { targetMode: 'all', targetTagId: '' } : { targetMode: 'tag', targetTagId: value.slice(4) })}
            />
          </div>
        </div>
        {publishOpen ? (
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="nen-publish-v8">公開日時（日本時間・任意）</label>
              <DateTimeField id="nen-publish-v8" aria-label="公開日時（日本時間）" value={draft.publishedAt} invalid={Boolean(errorFor('publishedAt'))} onChange={(value) => set({ publishedAt: value })} />
              {errorFor('publishedAt') ? <span className={styles.error} role="alert">{errorFor('publishedAt')}</span> : <span className={styles.muted}>空のままなら公開日時は入りません。日本時間で保存します。</span>}
            </div>
            <span aria-hidden="true" />
          </div>
        ) : null}
      </section>

      <section className={`${styles.card} ${styles.cardWide}`} aria-labelledby="nen-col-read">
        <h2 className={`${styles.cardTitle} ${styles.cardTitleLarge}`} id="nen-col-read">読んだ人にすること</h2>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>読了イベント名</span>
            <TextField aria-label="読了イベント名" value={draft.completionEventName} placeholder="例: 秋の食事コラムを読了" onChange={(event) => set({ completionEventName: event.target.value })} />
          </label>
          <div className={styles.field}>
            <span className={styles.labelSmall}>読了後に付けるタグ</span>
            <Select
              aria-label="読了後に付けるタグ"
              size="full"
              value={draft.completionTagId}
              options={[{ value: '', label: '付けない' }, ...accountTags.map((tag) => ({ value: tag.id, label: tag.name }))]}
              onChange={(value) => set({ completionTagId: value })}
            />
          </div>
        </div>
      </section>
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </CreatePage>
  )
}
