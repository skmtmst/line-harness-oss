'use client'

import React, { Suspense, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import ListState from '@/components/shared/list-state'
import PageHeader from '@/components/shared/page-header'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import {
  CATEGORY_MAX,
  EMPTY_DRAFT,
  EXCERPT_MAX,
  TITLE_MAX,
  canSubmit,
  failureOf,
  toCreateInput,
  validateDraft,
  type ColumnDraft,
  type Failure,
} from './column-form'
import styles from './column.module.css'

/**
 * NENコラムを書く（設計 `ymXJK` 21-1-E／契約 #618）。
 *
 * **記事の本文はここに保存しない。** 正本はEC側にあり、この画面が作るのは
 * 「外部記事へのリンクを持つ下書き」だけ。設計には本文の入力欄があるが、
 * 置くとどちらが正本なのか分からなくなるので、入れていない
 * （引き継ぎ `v6-nen-column-create-handoff.md` の完了条件）。
 */
function NewNenColumnInner() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [draft, setDraft] = useState<ColumnDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [touched, setTouched] = useState(false)

  if (!selectedAccountId) {
    return (
      <ListState
        kind="empty"
        title="LINEアカウントが選ばれていません"
        description="コラムはアカウントごとに保存します。上のLINEアカウントを選んでください。"
      />
    )
  }

  const errors = validateDraft(draft)
  const errorFor = (field: keyof ColumnDraft) =>
    touched ? errors.find((e) => e.field === field)?.message : undefined

  const save = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const res = await api.nenCampaigns.createColumn(selectedAccountId, toCreateInput(draft))
      if (!res.success) throw new Error('failed')
      /*
        **返ってきたIDは行き先にだけ使い、画面へは出さない。**
        slugやアカウントIDも同じ。利用者が読む値ではない。
      */
      router.push('/nen-campaigns?tab=columns')
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined
      const code = e instanceof ApiError ? e.code : undefined
      setFailure(failureOf({ status, code }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.screen} data-design-node="ymXJK">
      <PageHeader
        breadcrumb={[
          { label: 'NEN配信', href: '/nen-campaigns' },
          { label: 'NENコラム', href: '/nen-campaigns?tab=columns' },
          { label: '新しく書く' },
        ]}
        title="コラムを書く"
        description="外部サイトの記事へつなぐ下書きを作ります。記事本文は外部サイトで管理します。"
      />

      {failure ? (
        <p
          className={failure.kind === 'forbidden' ? styles.notice : styles.warn}
          role="alert"
          data-failure-kind={failure.kind}
        >
          {failure.message}
        </p>
      ) : null}

      <div className={styles.split}>
        <div className={styles.main}>
          <Card layout="vertical" className={styles.section} data-nen-part="title">
            <CardHeader title="題名と分類" />
            <Field
              label="題名"
              required
              value={draft.title}
              max={TITLE_MAX}
              error={errorFor('title')}
              onChange={(v) => setDraft((d) => ({ ...d, title: v }))}
            />
            <p className={styles.note}>
              LINEの通知に出るのは20文字までです。長いと途中で切れます。
            </p>
            <Field
              label="分類"
              value={draft.category}
              max={CATEGORY_MAX}
              placeholder="例: 季節のこと"
              error={errorFor('category')}
              onChange={(v) => setDraft((d) => ({ ...d, category: v }))}
            />
          </Card>

          <Card layout="vertical" className={styles.section} data-nen-part="article">
            <CardHeader title="記事のリンク" />
            {/*
              **本文の入力欄は置かない。** 記事の正本はEC側にある。
              ここに本文を持たせると、どちらを直せばよいのか分からなくなる。
            */}
            <p className={styles.note}>
              記事本文は外部サイトで管理します。ここではリンク先と、LINEに出す紹介文だけを決めます。
            </p>
            <Field
              label="記事のURL"
              required
              value={draft.articleUrl}
              placeholder="https://example.com/columns/..."
              error={errorFor('articleUrl')}
              onChange={(v) => setDraft((d) => ({ ...d, articleUrl: v }))}
            />
            <Field
              label="画像のURL"
              value={draft.imageUrl}
              placeholder="https://cdn.example.com/..."
              error={errorFor('imageUrl')}
              onChange={(v) => setDraft((d) => ({ ...d, imageUrl: v }))}
            />
            <Field
              label="概要"
              value={draft.excerpt}
              max={EXCERPT_MAX}
              placeholder="LINEのカードに出る短い紹介文"
              error={errorFor('excerpt')}
              onChange={(v) => setDraft((d) => ({ ...d, excerpt: v }))}
            />
          </Card>

          <Card layout="vertical" className={styles.section} data-nen-part="publish">
            <CardHeader title="公開日時" meta="空のままにすると、下書きとして保存します。" />
            <Field
              label="公開日時"
              value={draft.publishedAt}
              placeholder="2026-08-31T10:00:00+09:00"
              error={errorFor('publishedAt')}
              onChange={(v) => setDraft((d) => ({ ...d, publishedAt: v }))}
            />
            {/* 空のときに今日を補わない。補うと、書いただけのものが公開済みになる。 */}
            <p className={styles.note}>
              空のままなら公開日時は入りません。時差を含む形（+09:00）で書いてください。
            </p>
          </Card>
        </div>

        <aside className={styles.side}>
          <Card layout="vertical" className={styles.section} data-nen-part="preview">
            <CardHeader title="LINEに届く形" meta="入力した内容から組み立てています。" />
            <div className={styles.preview}>
              {draft.category.trim() ? <p className={styles.previewKind}>{draft.category.trim()}</p> : null}
              <p className={styles.previewTitle}>{draft.title.trim() || '（題名がまだありません）'}</p>
              <p className={styles.previewBody}>{draft.excerpt.trim() || '（概要がまだありません）'}</p>
              <p className={styles.previewCta}>コラムを読む</p>
            </div>
          </Card>

          <Card layout="vertical" className={styles.section}>
            <CardHeader title="この画面でできないこと" />
            <p className={styles.note}>
              配信の予約・公開・読んだ人への処理は、保存したあとにNENコラムの一覧から行います。
            </p>
          </Card>
        </aside>
      </div>

      <div className={styles.footer}>
        <p className={styles.note}>
          {canSubmit({ draft, busy })
            ? 'まだ保存していません。保存すると下書きとして一覧に並びます。'
            : '題名と記事のURLを入れると保存できます。'}
        </p>
        <div className={styles.actions}>
          <Button href="/nen-campaigns?tab=columns">キャンセル</Button>
          <Button
            type="button"
            variant="primary"
            data-qa-open="ymXJK"
            disabled={!canSubmit({ draft, busy })}
            onMouseDown={() => setTouched(true)}
            onClick={() => void save()}
          >
            {busy ? '保存中…' : '下書きに保存'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, required, max, placeholder, error,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  max?: number
  placeholder?: string
  error?: string
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        {required ? <span className={styles.required}>必須</span> : null}
        {max ? <span className={styles.count}>{value.trim().length} / {max}</span> : null}
      </span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className={`${styles.input} ${error ? styles.inputError : ''}`}
      />
      {error ? <span className={styles.fieldError}>{error}</span> : null}
    </label>
  )
}

export default function NewNenColumnPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <NewNenColumnInner />
    </Suspense>
  )
}
