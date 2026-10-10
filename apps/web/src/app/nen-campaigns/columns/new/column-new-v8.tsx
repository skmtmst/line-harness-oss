'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Tag } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Disclosure from '@/components/shared/disclosure'
import DateTimeField from '@/components/shared/date-time-field'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import LinePreview from '@/components/shared/line-preview'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { Check } from 'lucide-react'
import { TextField } from '@/components/shared/text-field'
import { api, ApiError } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useAccount } from '@/contexts/account-context'
import {
  CATEGORY_MAX,
  EMPTY_DRAFT,
  EXCERPT_MAX,
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
import { LineCard } from '../../line-preview'
import { formatNumber } from '@/lib/format'
import styles from './column-new-v8.module.css'
import { emptyValue } from '@/components/shared/empty-value'
import { Field } from '@/components/shared/form-controls'
import { PageHeading } from '@/components/templates/page-frame'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'


/*
 * ★V8-B コラムを書く（`yRDwW`）。
 *
 * v7（columns/new/page.tsx）とは別の部品として持ち、data-theme="v8" の
 * ときだけこちらが出る。下書きの決めごと（column-form の validate・
 * canSubmit・toCreateInput・failureOf）は同じ。違いは置き場と見せ方だけ——
 * ・節は 題名と分類・記事のリンク・届く形・いつだれに・読んだ人にすること。
 * ・右に LINE での見え方・読まれる書きかた・できないこと。
 * ・届く形の選び分けの口はまだ無いので、見え方の確認だけに使う
 *   （保存されるのは画像つきカードの今の作りのまま）。
 * ・前コラムの下敷きは一覧で選ぶ（今の作りのまま）。
 */

export default function ColumnNewV8() {
  const saveErrors = useSaveFormErrors()
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [draft, setDraft] = useState<ColumnDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [touched, setTouched] = useState(false)
  const [tags, setTags] = useState<Tag[]>([])
  const [audienceCount, setAudienceCount] = useState<number | null>(null)
  const [tagPruneNotice, setTagPruneNotice] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  useEffect(() => {
    void api.tags.list(selectedAccountId ? { accountId: selectedAccountId } : undefined)
      .then((response) => response.success && setTags(response.data)).catch(() => undefined)
  }, [selectedAccountId])
  useEffect(() => {
    if (draft.targetMode !== 'tag' || !draft.targetTagId) return
    if (!tags.some((tag) => tag.id === draft.targetTagId)) {
      setDraft({ ...draft, targetTagId: '' })
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

  if (!selectedAccountId) {
    return (
      <SaveErrorScope errors={saveErrors}><ListState
        kind="empty"
        title="LINEアカウントが選ばれていません"
        description="コラムはアカウントごとに保存します。上のLINEアカウントを選んでください。"
      /></SaveErrorScope>
    )
  }

  const errors = validateDraft(draft)
  const errorFor = (field: keyof ColumnDraft) =>
    touched ? errors.find((e) => e.field === field)?.message : undefined
  const accountTags = visibleAccountTags(tags, selectedAccountId)

  const save = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const res = await api.nenCampaigns.createColumn(selectedAccountId, toCreateInput(draft))
      if (!res.success) throw new Error('failed')
      router.push('/nen-campaigns?tab=columns')
    } catch (e) {
      const fieldFailure = saveErrors.capture(e);


      const status = e instanceof ApiError ? e.status : undefined
      const code = e instanceof ApiError ? e.code : undefined
      { if (!fieldFailure)
      setFailure(failureOf({ status, code })) }
    } finally {
      setBusy(false)
    }
  }

  const set = (patch: Partial<ColumnDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const previewColumn = {
    id: 'draft', externalId: null, slug: '', title: draft.title.trim() || '（題名がまだありません）',
    category: draft.category.trim() || null, excerpt: draft.excerpt.trim() || '（概要がまだありません）',
    introText: '', articleUrl: draft.articleUrl.trim(), imageUrl: draft.imageUrl.trim() || null,
    publishedAt: null, deliveryStatus: 'draft' as const, deliveryAt: null, lineAccountId: selectedAccountId,
    updatedAt: '', targetMode: draft.targetMode, targetTagId: draft.targetTagId || null,
    completionEventName: null, completionTagId: null, sourceColumnId: null,
  }

  return (
    <SaveErrorScope errors={saveErrors}><div data-design-node="yRDwW" className={styles.board}>
      <div className={styles.head}>
        <nav className={styles.crumb} aria-label="パンくず">
          <Link href="/nen-campaigns">← NEN配信へ</Link>
        </nav>
        <PageHeading title="コラムを書く" help={<> 外部サイトの記事へつなぐ下書きを作ります。記事本文は外部サイトで管理します。</>} />

      </div>

      {failure ? (
        <p className={styles.errorText} role="alert" data-failure-kind={failure.kind}>{failure.message}</p>
      ) : null}
      {tagPruneNotice ? <Notice tone="warn" message={tagPruneNotice} onClose={() => setTagPruneNotice(null)} /> : null}

      <div className={styles.split}>
        <div className={styles.main}>
          <section className={styles.card} aria-label="題名と分類" data-nen-part="title">
            <h2 className={styles.cardTitle}>題名と分類</h2>
            <Field label="題名"><SaveErrorField names={["title","draft.title"]}><TextField aria-label="題名" value={draft.title} maxLength={120} onChange={(event) => set({ title: event.target.value })} /></SaveErrorField></Field>
            {touched && errorFor('title') ? <p className={styles.fieldError}>{errorFor('title')}</p> : <p className={styles.note}>{titleNotice(draft.title) ?? `題名はLINEの通知に${TITLE_NOTICE_LENGTH}文字まで出ます。`}</p>}
            <div className={styles.row2}><Field label="分類"><SaveErrorField names={["category","draft.category"]}><TextField aria-label="分類" value={draft.category} maxLength={CATEGORY_MAX} placeholder="例：季節のこと" onChange={(event) => set({ category: event.target.value })} /></SaveErrorField><div className={styles.fieldLabel}>
                前のコラムを下敷きにする
                <Link href="/nen-campaigns?tab=columns" className={styles.linkAction}>一覧で元のコラムを選びます →</Link>
              </div></Field></div>
            <Field label="概要（LINE のカードに出る短い紹介文）"><SaveErrorField names={["excerpt","draft.excerpt"]}><TextField aria-label="概要" value={draft.excerpt} maxLength={EXCERPT_MAX} onChange={(event) => set({ excerpt: event.target.value })} /></SaveErrorField></Field>
          </section>

          <section className={styles.card} aria-label="記事のリンク" data-nen-part="article">
            <h2 className={styles.cardTitle}>記事のリンク</h2>
            <Field label="記事の URL"><SaveErrorField names={["articleUrl","draft.articleUrl","article_url","draft.article_url"]}><TextField aria-label="記事の URL" value={draft.articleUrl} placeholder="https://example.com/columns/..." onChange={(event) => set({ articleUrl: event.target.value })} /></SaveErrorField></Field>
            {touched && errorFor('articleUrl') ? <p className={styles.fieldError}>{errorFor('articleUrl')}</p> : null}
            <Field label="画像の URL"><SaveErrorField names={["imageUrl","draft.imageUrl","image_url","draft.image_url"]}><TextField aria-label="画像の URL" value={draft.imageUrl} placeholder="https://cdn.example.com/..." onChange={(event) => set({ imageUrl: event.target.value })} /></SaveErrorField></Field>
          </section>

          <section className={styles.card} aria-label="届く形">
            <h2 className={styles.cardTitle}>届く形</h2>
            <SaveErrorField names={["column-kind"]}><RadioCardGroup legend="届く形" className={styles.row2}>
              <RadioCard name="column-kind" value="card" checked onChange={() => {}}
                title="上の写真＋コラムを読む" note="写真の下に題名とボタン" />
              <RadioCard name="column-kind" value="text" checked={false} onChange={() => {}}
                title="文字だけ" note="題名と概要とリンク" disabled disabledReason="この配信では選べません" />
            </RadioCardGroup></SaveErrorField>
          </section>

          <section className={styles.card} aria-label="いつ・だれに出しますか" data-nen-part="publish">
            <h2 className={styles.cardTitle}>いつ・だれに出しますか</h2>
            <p className={styles.note}>この日時は下書きに記録されます。実際の配信は、一覧で「この内容で予約する」を押したときだけ始まります。</p>
            <div className={styles.row2}>
              <div className={styles.fieldLabel}><Field label="配信日時（日本時間）" htmlFor="nen-schedule-v8"><SaveErrorField names={["scheduledAt","draft.scheduledAt","scheduled_at","draft.scheduled_at"]}><DateTimeField id="nen-schedule-v8" aria-label="配信日時（日本時間）" value={draft.scheduledAt} invalid={Boolean(touched && errorFor('scheduledAt'))} onChange={(v) => set({ scheduledAt: v })} /></SaveErrorField></Field></div>
              <Field label="配信対象"><SaveErrorField names={["targetMode","draft.targetMode","target_mode","draft.target_mode"]}><Select
                  aria-label="配信対象"
                  value={draft.targetMode}
                  options={[
                    { value: 'all', label: '友だち全員' },
                    { value: 'tag', label: 'タグで絞る' },
                  ]}
                  onChange={(value) => set({ targetMode: value as 'all' | 'tag' })}
                /></SaveErrorField></Field>
            </div>
            {draft.targetMode === 'tag' ? (
              <Field label="対象タグ"><SaveErrorField names={["targetTagId","draft.targetTagId","target_tag_id","draft.target_tag_id"]}><Select
                  aria-label="対象タグ"
                  value={draft.targetTagId}
                  options={[
                    { value: '', label: 'タグを選択' },
                    ...accountTags.map((tag) => ({ value: tag.id, label: tag.name })),
                  ]}
                  onChange={(value) => set({ targetTagId: value })}
                /></SaveErrorField></Field>
            ) : null}
            <p className={styles.note}>この条件では {audienceCount == null ? emptyValue('unknown') : formatNumber(audienceCount)}人に届きます。</p>
            <Disclosure title="公開日時も記録する（任意）" size="compact">
            <div className={styles.fieldLabel}><Field label="公開日時（日本時間）" htmlFor="nen-publish-v8"><SaveErrorField names={["publishedAt","draft.publishedAt","published_at","draft.published_at"]}><DateTimeField id="nen-publish-v8" aria-label="公開日時（日本時間）" value={draft.publishedAt} invalid={Boolean(touched && errorFor('publishedAt'))} onChange={(v) => set({ publishedAt: v })} /></SaveErrorField></Field></div>
            <p className={styles.note}>空のままなら公開日時は入りません。日本時間で保存します。</p>
            </Disclosure>
          </section>

          <section className={styles.card} aria-label="読んだ人にすること">
            <h2 className={styles.cardTitle}>読んだ人にすること</h2>
            <div className={styles.row2}>
              <Field label="読了イベント名"><SaveErrorField names={["completionEventName","draft.completionEventName","completion_event_name","draft.completion_event_name"]}><TextField aria-label="読了イベント名" value={draft.completionEventName} placeholder="例：秋の食事コラムを読了" onChange={(event) => set({ completionEventName: event.target.value })} /></SaveErrorField></Field>
              <Field label="読了後に付けるタグ"><SaveErrorField names={["completionTagId","draft.completionTagId","completion_tag_id","draft.completion_tag_id"]}><Select
                  aria-label="読了後に付けるタグ"
                  value={draft.completionTagId}
                  options={[
                    { value: '', label: '付けない' },
                    ...accountTags.map((tag) => ({ value: tag.id, label: tag.name })),
                  ]}
                  onChange={(value) => set({ completionTagId: value })}
                /></SaveErrorField></Field>
            </div>
          </section>
        </div>

        <aside className={styles.side}>
          <section className={styles.preview} aria-label="LINE での見え方" data-nen-part="preview">
            <h2 className={styles.cardTitle}>LINE での見え方</h2>
            <LinePreview caption={draft.scheduledAt ? draft.scheduledAt.replace('T', ' ') : '配信日時は未設定'}>
              <LineCard imageUrl={previewColumn.imageUrl} category={previewColumn.category}
                title={previewColumn.title} body={previewColumn.excerpt} buttonLabel="コラムを読む" />
            </LinePreview>
          </section>
          <section className={styles.card} aria-label="読まれるコラムの書きかた">
            <h2 className={styles.cardTitle}>読まれるコラムの書きかた</h2>
            <ul className={styles.tips}>
              <li>相談の言葉から始める</li>
              <li>売り込みを入れない</li>
              <li>差し込む言葉（お名前・ペット名）は1つまで</li>
            </ul>
          </section>
          <section className={styles.card} aria-label="この画面でできないこと">
            <h2 className={styles.cardTitle}>この画面でできないこと</h2>
            <p className={styles.note}>記事の本文を書く（外部サイトで書きます）・出した後の細かい設定（一斉配信と同じ）</p>
          </section>
        </aside>
      </div>

      <StickyBar
        status={canSubmit({ draft, busy }) ? 'まだ保存していません。保存すると下書きとして一覧に並びます。' : '題名と記事のURLを入れると保存できます。'}
        actions={(
          <>
            <Button href="/nen-campaigns?tab=columns">キャンセル</Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canSubmit({ draft, busy })}
              onMouseDown={() => setTouched(true)}
              onClick={() => void save()}
              busy={busy}
              busyLabel="保存しています…"
            >
              <Check size={14} aria-hidden="true" />下書きを保存
            </Button>
          </>
        )}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div></SaveErrorScope>
  )
}
