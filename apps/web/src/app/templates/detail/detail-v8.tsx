'use client'

/*
 * ★V8 テンプレートの詳細。
 * Pencil：詳細（未公開の変更あり）`UTbi1`、公開する `cuR8I`、
 * 削除（使っている所がある）`Z0g3si`／（使っていない）`V6JFnd`。
 *
 * v7 の見た目は変えない。data-theme="v8" のときだけこちらが出る。
 * 動き（読み込み・公開の競合・削除の安全・権限）は v7 の detail/page.tsx
 * と同じに保つ。
 *
 * 「複製する」はサーバー側に POST /api/templates/:id/duplicate がまだ
 * 無い（直しかけを写さない決まりのため、画面側の写しでは作れない）ので
 * API待ち。DEVIN-QUESTIONS.md に記録済み。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, CircleAlert, ExternalLink, Send, UploadCloud } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import LinePreview from '@/components/shared/line-preview'
import { MoreAction } from '@/components/shared/row-actions'
import TargetMissing from '@/components/shared/target-missing'
import VersionCompare from '@/components/shared/version-compare'
import FlexPreviewComponent from '@/components/flex-preview'
import { validateFlexContent } from '@line-crm/shared'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { formatDateTime } from '@/lib/format'
import { templateDeleteDescription } from '../template-delete-message'
import { messageTypeText } from '../template-message-type'
import { isTemplateDetailData, type TemplateDetailData } from '../template-detail-data'
import styles from './detail-v8.module.css'

type Usage = NonNullable<TemplateDetailData['usedBy']>

interface TemplateVersionItem {
  versionNumber: number
  status: 'in_use' | 'reserved' | 'past'
  messageContent: string
  effectiveFrom: string | null
  createdAt: string
}

/** 「使っている版」の表示。無い版番号はでっち上げず「—」。 */
function versionText(version: number | null): string {
  return version === null || version === undefined ? 'いまの版' : `版${version}で固定`
}

/** 一斉配信の状態の札。予約済みは待っている途中、送信済みは終わり。 */
function broadcastStatusText(status: string): string {
  if (status === 'scheduled') return '予約中'
  if (status === 'sending') return '送信中'
  if (status === 'sent') return '送信済み'
  return '下書き'
}

/** R347: 旧版に固定された登録の状態の札。取消ずみは再開すると送り直す。 */
function enrollmentStatusText(status: string): string {
  if (status === 'active') return '送信待ち'
  if (status === 'cancelled') return '取消ずみ'
  return status
}

/** 本文の {名前} のような差し込みを拾って「名前・予約日時」の形にする。 */
function insertionNames(content: string): string[] {
  const found = new Set<string>()
  for (const match of content.matchAll(/\{([^{}]+)\}/g)) {
    const name = match[1]?.trim()
    if (name) found.add(name)
  }
  return [...found]
}

interface UsageRow {
  key: string
  kind: string
  name: string
  /** 使っている版の表示（いまの版／版Nで固定）。 */
  version: string
  /** 版を決めている（公開しても変わらない）行。 */
  fixed: boolean
  status: string | null
  href: string | null
}

/** 使っている所の表の行（v7 の分け方＋版を決めているかの印）。 */
function buildUsageRows(usage: Usage | null): UsageRow[] {
  if (!usage) return []
  const broadcasts = usage.broadcasts ?? []
  const enrollments = usage.reminderEnrollments ?? []
  return [
    ...broadcasts.map((u) => {
      const fixed = u.referenceMode === 'fixed' || u.templateVersionNumber !== null
      return {
        key: `broadcast-${u.broadcastId}`,
        kind: '一斉配信',
        name: `${u.title}（${broadcastStatusText(u.status)}）`,
        version: fixed ? versionText(u.templateVersionNumber) : 'いまの版',
        fixed,
        status: broadcastStatusText(u.status),
        href: u.status === 'scheduled'
          ? `/broadcasts/reserved?id=${u.broadcastId}`
          : `/broadcasts/detail?id=${u.broadcastId}`,
      }
    }),
    ...usage.autoReplies.map((u) => ({
      key: `auto-reply-${u.id}`,
      kind: '自動応答',
      name: u.keyword,
      version: versionText(u.templateVersion ?? null),
      fixed: u.templateVersion !== null && u.templateVersion !== undefined,
      status: null,
      href: `/auto-replies/edit?id=${u.id}`,
    })),
    ...usage.scenarioSteps.map((u) => ({
      key: `scenario-step-${u.stepId}`,
      kind: 'シナリオ配信',
      name: `${u.scenarioName}・${u.stepOrder}通目`,
      version: versionText(u.templateVersion ?? null),
      fixed: u.templateVersion !== null && u.templateVersion !== undefined,
      status: null,
      href: `/scenarios/detail?id=${u.scenarioId}`,
    })),
    ...usage.reminderSteps.map((u) => ({
      key: `reminder-step-${u.reminderId}-${u.stepId}`,
      kind: 'リマインダ',
      name: u.reminderName,
      version: 'いまの版',
      fixed: false,
      status: null,
      href: `/reminders/edit?id=${u.reminderId}`,
    })),
    ...enrollments.map((u) => ({
      key: `reminder-enrollment-${u.enrollmentId}`,
      kind: 'リマインダ',
      name: u.reminderName,
      version: versionText(u.versionNumber),
      fixed: true,
      status: enrollmentStatusText(u.enrollmentStatus),
      href: `/reminders/detail?id=${u.reminderId}`,
    })),
    ...usage.richMenuAreas.map((u) => ({
      key: `rich-menu-${u.groupId}-${u.areaId}`,
      kind: 'リッチメニュー',
      name: `${u.groupName}・${u.pageName}${u.label ? `・${u.label}` : ''}`,
      version: 'いまの版',
      fixed: false,
      status: null,
      href: `/rich-menus/edit?id=${u.groupId}`,
    })),
    ...usage.trackedLinks.map((u) => ({
      key: `tracked-link-${u.id}`,
      kind: '流入リンク',
      name: u.name,
      version: 'いまの版',
      fixed: false,
      status: null,
      href: `/inflow-links/detail?id=${u.id}`,
    })),
    // 旧形式のオートメーションには開ける画面が無い。
    ...usage.automations.map((u) => ({
      key: `automation-${u.id}`,
      kind: 'オートメーション',
      name: u.name,
      version: 'いまの版',
      fixed: false,
      status: null,
      href: null,
    })),
  ]
}

/** 表にまず見せる行数。残りは「ほか N か所を見る」で開く。 */
const USAGE_VISIBLE = 4

export default function TemplateDetailV8() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId } = useAccount()

  const [template, setTemplate] = useState<TemplateDetailData | null>(null)
  const [versions, setVersions] = useState<TemplateVersionItem[] | null>(null)
  const [versionsError, setVersionsError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)

  const [folderName, setFolderName] = useState<string | null>(null)
  const [monthlySends, setMonthlySends] = useState<number | null | undefined>(undefined)

  const [showAllUsages, setShowAllUsages] = useState(false)
  /** 「比べる」で開く差分。'draft' はいまの版と下書き、数字はその版といまの版。 */
  const [compareTarget, setCompareTarget] = useState<'draft' | number | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [revertTarget, setRevertTarget] = useState<number | null>(null)
  const [reverting, setReverting] = useState(false)
  const [revertError, setRevertError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [blockedOpen, setBlockedOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [headMenuOpen, setHeadMenuOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)

  /*
   * N-144: 編集・公開・削除APIは owner/admin だけ。staff へは閲覧だけ残し、
   * 押すと 403 になる口は出さない。
   */
  const [canMutateTemplates] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())
  usePageTitle(template?.name ?? null)

  const loadVersions = useCallback(async () => {
    if (!id) return
    setVersionsError('')
    try {
      const res = await api.templates.versions(id)
      if (res.success) {
        setVersions(res.data)
      } else {
        setVersionsError('版の履歴を読み込めませんでした。もう一度お試しください。')
      }
    } catch {
      setVersionsError('版の履歴を読み込めませんでした。もう一度お試しください。')
    }
  }, [id])

  const reload = useCallback(async () => {
    setMissing(false)
    setError('')
    setTemplate(null)
    setVersions(null)
    setCompareTarget(null)
    setShowAllUsages(false)
    setLoading(true)
    try {
      const detail = await api.templates.get(id)
      if (detail.success && isTemplateDetailData(detail.data)) {
        setTemplate(detail.data)
      } else if (!detail.success) {
        setError('テンプレートを読み込めませんでした。もう一度お試しください。')
      } else {
        /*
         * D008: success:true だが形が違う応答（存在しないIDへの一覧形など）。
         * 無いものを「ある」ように描くと編集・削除の口まで出るので、
         * 見つからないものとして扱う。
         */
        setMissing(true)
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setMissing(true)
      } else {
        setError('テンプレートを読み込めませんでした。もう一度お試しください。')
      }
    } finally {
      setLoading(false)
    }
    void loadVersions()
  }, [id, loadVersions])

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    void reload()
  }, [id, reload])

  /* フォルダ名と今月送った数は詳細口に無いので、持っている口で拾う。 */
  useEffect(() => {
    if (!selectedAccountId) return
    let cancelled = false
    api.folders.list('template', selectedAccountId).then((res) => {
      if (cancelled || !res.success) return
      const match = res.data.find((folder) => folder.id === template?.folderId)
      setFolderName(match?.name ?? null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [selectedAccountId, template?.folderId])

  useEffect(() => {
    if (!selectedAccountId || !template) return
    let cancelled = false
    api.templates.list(undefined, selectedAccountId).then((res) => {
      if (cancelled || !res.success) return
      const match = res.data.find((item) => item.id === template.id)
      setMonthlySends(match?.monthlySendCount ?? null)
    }).catch(() => setMonthlySends(null))
    return () => { cancelled = true }
  }, [selectedAccountId, template])

  const usageRows = useMemo(() => buildUsageRows(template?.usedBy ?? null), [template])
  const usageCount = usageRows.length
  const latestCount = usageRows.filter((row) => !row.fixed).length
  const fixedCount = usageCount - latestCount
  const fixedBroadcasts = (template?.usedBy?.broadcasts ?? []).filter(
    (b) => (b.referenceMode === 'fixed' || b.templateVersionNumber !== null)
      && (b.status === 'scheduled' || b.status === 'sending'),
  ).length
  const inUseVersion = (versions ?? []).find((v) => v.status === 'in_use') ?? null
  const draftContent = template?.messageContent ?? ''
  const nextVersionNumber = (template?.publishedVersion ?? 0) + 1

  const doPublish = useCallback(async () => {
    if (publishing || !template) return
    setPublishing(true)
    setPublishError('')
    try {
      const res = await api.templates.publish(id, {
        expectedVersion: template.publishedVersion ?? 0,
        expectedDraftRevision: template.draftRevision ?? 0,
      })
      if (!res.success) throw new Error(res.error)
      setPublishOpen(false)
      await reload()
    } catch (caught) {
      // 生のAPIエラーは運用者に読めないので、窓の中に運用の言葉で出す。
      if (caught instanceof ApiError && caught.status === 409) {
        setPublishError('ほかの人が先に公開・編集しました。最新の状態を読み直したので、内容を確かめてからもう一度お試しください。')
        void reload()
      } else {
        setPublishError('公開できませんでした。状態を読み直してから、もう一度お試しください。')
      }
    } finally {
      setPublishing(false)
    }
  }, [id, publishing, template, reload])

  const doRevert = useCallback(async () => {
    if (reverting || revertTarget === null || !template) return
    setReverting(true)
    setRevertError('')
    try {
      const res = await api.templates.revert(id, {
        versionNumber: revertTarget,
        expectedVersion: template.publishedVersion,
      })
      if (!res.success) throw new Error(res.error)
      setRevertTarget(null)
      setCompareTarget(null)
      await reload()
    } catch (caught) {
      setRevertError(
        caught instanceof ApiError && caught.status === 409
          ? 'ほかの人が先に公開しました。開き直して確認してください。'
          : 'この版に戻せませんでした。状態を読み直してから、もう一度お試しください。',
      )
    } finally {
      setReverting(false)
    }
  }, [id, reverting, revertTarget, template, reload])

  const remove = useCallback(async () => {
    if (deleting || usageCount > 0 || !template) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.templates.delete(id)
      if (!res.success) throw new Error(res.error)
      setDeleteOpen(false)
      router.push('/templates')
    } catch {
      setDeleteError('このテンプレートを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }, [deleting, usageCount, template, id, router])

  const openDelete = useCallback(() => {
    setDeleteError('')
    if (usageCount > 0) {
      setBlockedOpen(true)
    } else {
      setDeleteOpen(true)
    }
  }, [usageCount])

  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="見るテンプレートが指定されていません"
        description="一覧から、見たいテンプレートを選び直してください。"
        backHref="/templates"
        backLabel="テンプレートの一覧へ戻る"
      />
    )
  }

  if (missing || (!error && !loading && !template)) {
    return (
      <TargetMissing
        kind="not-found"
        title="このテンプレートは見つかりません"
        description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。"
        backHref="/templates"
        backLabel="テンプレートの一覧へ戻る"
      />
    )
  }

  if (error || (!loading && !template)) {
    return (
      <TargetMissing
        kind="error"
        title="テンプレートを読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void reload()}
      />
    )
  }

  const editHref = template
    ? template.question
      ? `/templates/questions/new?id=${encodeURIComponent(id)}`
      : `/templates/edit?id=${encodeURIComponent(id)}`
    : `/templates/edit?id=${encodeURIComponent(id)}`
  const insertions = insertionNames(draftContent)
  const headMenuItems: ActionMenuItem[] = [
    {
      id: 'delete',
      label: '削除する',
      tone: 'danger',
      onSelect: openDelete,
    },
  ]
  const publishUsageRows = usageRows.slice(0, 4)
  const compareAfter = compareTarget === 'draft'
    ? draftContent
    : (versions ?? []).find((v) => v.versionNumber === compareTarget)?.messageContent ?? null

  return (
    <div className={styles.board} data-design-node="UTbi1">
      <nav data-design="Crumb">
        <Link href="/templates" className={styles.crumb}>
          <ChevronLeft size={14} aria-hidden="true" />
          テンプレートへ
        </Link>
      </nav>

      {loading || !template ? (
        <div className={styles.card} role="status">
          <p className="text-ink-faint" style={{ margin: 0, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
            読み込み中...
          </p>
        </div>
      ) : (
        <>
          <header data-design="Head" className={styles.head}>
            <h1 className={styles.headTitle}>{template.name}</h1>
            <p className={styles.headMeta}>
              {[messageTypeText(template.messageType), folderName ?? template.category ?? '未分類']
                .filter(Boolean)
                .join('・')}
              ・更新 {formatDateTime(template.updatedAt)}
            </p>
          </header>

          {template.hasDraft ? (
            <div className={styles.draftBand} role="status">
              <span className={styles.draftBandIcon} aria-hidden="true">
                <CircleAlert size={18} />
              </span>
              <div className={styles.draftBandBody}>
                <p className={styles.draftBandTitle}>
                  {template.publishedVersion > 0 ? '未公開の変更があります' : 'まだ公開していません'}
                </p>
                <p className={styles.draftBandText}>
                  {template.publishedVersion > 0
                    ? `公開すると、使っている ${usageCount} か所のうち「いまの版」を使う ${latestCount} か所に新しい内容が使われます。`
                      + (fixedBroadcasts > 0
                        ? `版を決めて予約した一斉配信 ${fixedBroadcasts} 件は、決めた版のまま送ります。`
                        : fixedCount > 0
                          ? `版を決めた ${fixedCount} か所は、決めた版のまま送ります。`
                          : '')
                    : '公開すると配信で選べるようになります。公開するまで使っている所は変わりません。'}
                </p>
                {compareTarget === 'draft' && inUseVersion ? (
                  <div className={styles.draftBandCompare}>
                    <VersionCompare before={inUseVersion.messageContent} after={draftContent} />
                  </div>
                ) : null}
              </div>
              {canMutateTemplates ? (
                <div className={styles.draftBandActions}>
                  {inUseVersion ? (
                    <Button
                      variant="secondary"
                      onClick={() => setCompareTarget((current) => (current === 'draft' ? null : 'draft'))}
                    >
                      比べる
                    </Button>
                  ) : null}
                  <Button variant="primary" onClick={() => { setPublishError(''); setPublishOpen(true) }}>
                    <UploadCloud size={14} aria-hidden="true" />
                    公開する
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div data-design="Body" className={styles.split}>
            <div data-design="Left" className={styles.mainCol}>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <h2 className={styles.cardTitle}>
                    本文{template.hasDraft ? '（下書き）' : ''}
                  </h2>
                  {canMutateTemplates ? (
                    <Button href={editHref} variant="secondary">編集する</Button>
                  ) : null}
                </div>
                <p className={styles.cardNote}>
                  {'{'} の中身は差し込み。受け取る人ごとに変わります。
                </p>
                <div className={styles.bodyBubble}>{draftContent}</div>
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>使っている所</h2>
                <p className={styles.cardNote}>
                  {usageCount > 0
                    ? `${usageCount} か所。「いまの版」を使う ${latestCount} か所に反映されます`
                      + (fixedCount > 0 ? `（版を決めた ${fixedCount} か所は変わりません）` : '')
                      + '。'
                    : 'どこからも呼ばれていません。使われると、ここに並びます。'}
                </p>
                {usageCount > 0 ? (
                  <>
                    <table className={styles.usageTable}>
                      <thead>
                        <tr>
                          <th>種類</th>
                          <th>名前</th>
                          <th>使っている版</th>
                          <th>状態</th>
                          <th><span className="sr-only">操作</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(showAllUsages ? usageRows : usageRows.slice(0, USAGE_VISIBLE)).map((row) => (
                          <tr key={row.key}>
                            <td className={styles.usageKind}>{row.kind}</td>
                            <td className={styles.usageName}>
                              <span className={styles.usageCellText} title={row.name}>{row.name}</span>
                            </td>
                            <td className={`${styles.usageVersion} ${row.fixed ? styles.usageVersionFixed : ''}`}>
                              {row.version}
                            </td>
                            <td className={styles.usageCellText}>{row.status ?? '—'}</td>
                            <td className={styles.usageOpen}>
                              {row.href ? (
                                <Link href={row.href} className={styles.usageNameLink}>開く</Link>
                              ) : (
                                <span className="text-ink-faint" style={{ fontSize: 12 }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {usageCount > USAGE_VISIBLE && !showAllUsages ? (
                      <div className={styles.usageMore}>
                        <Button variant="secondary" onClick={() => setShowAllUsages(true)}>
                          ほか {usageCount - USAGE_VISIBLE} か所を見る
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.usageEmpty}>まだ使われていません</p>
                )}
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>版の履歴</h2>
                <p className={styles.cardNote}>
                  戻すと、その版を下書きとして作り直します。公開するまで使っている所は変わりません。
                </p>
                {versions === null && !versionsError ? (
                  <p className="text-ink-faint" style={{ fontSize: 13, margin: '8px 0 0' }}>読み込み中...</p>
                ) : versionsError ? (
                  <div>
                    <p className="text-ink-secondary" style={{ fontSize: 13, margin: '8px 0' }}>{versionsError}</p>
                    <Button variant="secondary" onClick={() => void loadVersions()}>もう一度読み込む</Button>
                  </div>
                ) : (
                  <>
                    {template.hasDraft ? (
                      <div className={`${styles.versionRow} ${styles.versionRowDraft}`}>
                        <span className={styles.versionNum}>版{nextVersionNumber}</span>
                        <div className={styles.versionBody}>
                          <p className={styles.versionLabel}>下書き（まだ公開していない）</p>
                          <p className={styles.versionMeta}>{formatDateTime(template.updatedAt)}</p>
                        </div>
                        {inUseVersion ? (
                          <div className={styles.versionActions}>
                            <Button
                              variant="secondary"
                              onClick={() => setCompareTarget((current) => (current === 'draft' ? null : 'draft'))}
                            >
                              いまの版と比べる
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {(versions ?? []).map((version) => (
                      <div
                        key={version.versionNumber}
                        className={`${styles.versionRow} ${version.status === 'in_use' ? styles.versionRowInUse : ''}`}
                      >
                        <span className={styles.versionNum}>版{version.versionNumber}</span>
                        <div className={styles.versionBody}>
                          <p className={styles.versionLabel}>
                            {version.status === 'in_use'
                              ? 'いま使っている版'
                              : version.status === 'reserved'
                                ? `予約した版（${version.effectiveFrom ? `${formatDateTime(version.effectiveFrom)}から使う` : '予約中'}）`
                                : '前の版'}
                          </p>
                          <p className={styles.versionMeta}>{formatDateTime(version.createdAt)}</p>
                        </div>
                        {version.status !== 'in_use' ? (
                          <div className={styles.versionActions}>
                            <Button
                              variant="secondary"
                              onClick={() => setCompareTarget((current) => (current === version.versionNumber ? null : version.versionNumber))}
                            >
                              比べる
                            </Button>
                            {canMutateTemplates ? (
                              <Button
                                variant="secondary"
                                onClick={() => { setRevertError(''); setRevertTarget(version.versionNumber) }}
                              >
                                この版に戻す
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {compareTarget !== null && compareTarget !== 'draft' && compareAfter !== null && inUseVersion ? (
                      <div className={styles.versionCompare}>
                        <p className={styles.publishDiffTitle}>
                          比べる（いま使っている版{inUseVersion.versionNumber} ← 版{compareTarget}）
                        </p>
                        <VersionCompare before={inUseVersion.messageContent} after={compareAfter} />
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            </div>

            <aside data-design="Right" className={styles.sideCol}>
              {canMutateTemplates ? (
                <div className={styles.actionRow}>
                  <Button
                    href={`/broadcasts/new?templatePicker=1&templateId=${encodeURIComponent(id)}`}
                    variant="secondary"
                  >
                    <Send size={14} aria-hidden="true" />
                    一斉配信で使う
                  </Button>
                  <div className={styles.moreWrap}>
                    <MoreAction
                      label="そのほかの操作"
                      buttonRef={moreRef}
                      onClick={() => setHeadMenuOpen((current) => !current)}
                    />
                    <ActionMenu
                      open={headMenuOpen}
                      onClose={() => setHeadMenuOpen(false)}
                      anchorRef={moreRef}
                      ariaLabel={`テンプレート「${template.name}」の操作`}
                      items={headMenuItems}
                    />
                  </div>
                </div>
              ) : null}

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>このテンプレートについて</h2>
                <dl className={styles.aboutList}>
                  <div className={styles.aboutRow}>
                    <dt className={styles.aboutLabel}>種類</dt>
                    <dd className={styles.aboutValue}>{messageTypeText(template.messageType)}</dd>
                  </div>
                  <div className={styles.aboutRow}>
                    <dt className={styles.aboutLabel}>フォルダ</dt>
                    <dd className={styles.aboutValue}>{folderName ?? template.category ?? '未分類'}</dd>
                  </div>
                  <div className={styles.aboutRow}>
                    <dt className={styles.aboutLabel}>今月送った数</dt>
                    <dd className={styles.aboutValue}>
                      {monthlySends === undefined ? '読み込み中…' : monthlySends === null ? '—' : `${monthlySends.toLocaleString('ja-JP')}通`}
                    </dd>
                  </div>
                  <div className={styles.aboutRow}>
                    <dt className={styles.aboutLabel}>差し込み</dt>
                    <dd className={styles.aboutValue}>{insertions.length > 0 ? insertions.join('・') : 'なし'}</dd>
                  </div>
                  <div className={styles.aboutRow}>
                    <dt className={styles.aboutLabel}>使われている数</dt>
                    <dd className={styles.aboutValue}>{usageCount}か所</dd>
                  </div>
                </dl>
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>届き方</h2>
                {/*
                  R249: カード型は編集と同じカード表示にする。本文の
                  生表示では壊れたカードが「作れた」ように見える。
                  形式が壊れている間は誤りを名指しし、直し先へ案内する。
                */}
                {template.messageType === 'flex' ? (
                  (() => {
                    const flexError = validateFlexContent('flex', draftContent)
                    if (flexError) {
                      return (
                        <div role="alert" className={styles.bodyBubble}>
                          <p className="text-danger" style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{flexError}</p>
                          <p className="text-ink-secondary" style={{ margin: '4px 0 0', fontSize: 12 }}>
                            このままでは公開できません。
                            {canMutateTemplates ? (
                              <Link href={editHref} className="text-action" style={{ textDecoration: 'underline' }}>再編集で直してください。</Link>
                            ) : 'オーナー・管理者に再編集を依頼してください。'}
                          </p>
                        </div>
                      )
                    }
                    return (
                      <LinePreview accountName="然 - NEN -">
                        <FlexPreviewComponent content={draftContent} />
                      </LinePreview>
                    )
                  })()
                ) : (
                  <LinePreview accountName="然 - NEN -">
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {draftContent}
                    </p>
                  </LinePreview>
                )}
              </section>
            </aside>
          </div>
        </>
      )}

      {/* 公開の確かめ窓（`cuR8I`）：使っている所と変わるところを見せてから公開する。 */}
      <Dialog
        open={publishOpen}
        title={`「${template?.name ?? ''}」を公開する`}
        description={
          `公開すると、下のうち「いまの版」を使う所で新しい内容（版${nextVersionNumber}）が使われます。`
          + '版を決めた予約と、すでに送ったメッセージは変わりません。'
        }
        designNode="cuR8I"
        busy={publishing}
        error={publishError}
        confirmLabel={latestCount > 0 ? `公開する（${latestCount} か所に反映）` : '公開する'}
        confirmIcon={<UploadCloud size={16} aria-hidden="true" />}
        onConfirm={() => void doPublish()}
        onCancel={() => {
          if (publishing) return
          setPublishOpen(false)
          setPublishError('')
        }}
      >
        {usageCount > 0 ? (
          <>
            <div className={styles.publishList}>
              {publishUsageRows.map((row) => (
                <div key={row.key} className={styles.publishRow}>
                  <span className={styles.publishRowKind}>{row.kind}</span>
                  <span className={styles.publishRowName} title={row.name}>{row.name}</span>
                  <span className={`${styles.publishRowState} ${row.fixed ? styles.publishRowStateFixed : ''}`}>
                    {row.fixed
                      ? `${row.status ?? ''}${row.status ? '・' : ''}${row.version.replace('で固定', 'のまま')}`
                      : (row.status ?? '')}
                  </span>
                </div>
              ))}
            </div>
            {usageCount > publishUsageRows.length ? (
              <p className={styles.publishMore}>ほか {usageCount - publishUsageRows.length} か所</p>
            ) : null}
          </>
        ) : null}
        {inUseVersion ? (
          <>
            <p className={styles.publishDiffTitle}>
              変わるところ（版{inUseVersion.versionNumber} → 版{nextVersionNumber}）
            </p>
            <VersionCompare before={inUseVersion.messageContent} after={draftContent} />
          </>
        ) : null}
      </Dialog>

      {/* 削除できない窓（`Z0g3si`：使っている所がある）。 */}
      <Dialog
        open={blockedOpen}
        title={`テンプレート「${template?.name ?? ''}」は削除できません`}
        description={`${usageCount} か所で使われています。先に使っている所で別のテンプレートに差し替えるか、その設定を止めてください。`}
        designNode="Z0g3si"
        confirmLabel="閉じる"
        onConfirm={() => setBlockedOpen(false)}
        onCancel={() => setBlockedOpen(false)}
      >
        <ul className={styles.blockedList}>
          {usageRows.map((row) => (
            <li key={row.key} className={styles.blockedItem}>
              <span className={styles.blockedItemIcon} aria-hidden="true">
                <ExternalLink size={13} />
              </span>
              {row.href ? (
                <Link href={row.href} className={styles.blockedItemLink}>{row.kind}「{row.name}」</Link>
              ) : (
                <span>{row.kind}「{row.name}」（開ける画面がありません）</span>
              )}
            </li>
          ))}
        </ul>
      </Dialog>

      {/* 削除の確認窓（`V6JFnd`：使っていないテンプレート）。 */}
      <ConfirmDialog
        open={deleteOpen && usageCount === 0}
        title={`テンプレート「${template?.name ?? ''}」を削除しますか？`}
        description={templateDeleteDescription(usageCount)}
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void remove()}
        onCancel={() => {
          if (deleting) return
          setDeleteOpen(false)
          setDeleteError('')
        }}
        designNode="V6JFnd"
      />

      {/* この版に戻すの確認。 */}
      <ConfirmDialog
        open={revertTarget !== null}
        title={`版${revertTarget}の内容で下書きを作り直しますか？`}
        description="過去の版は変わりません。その中身で新しい下書きを作ります。予約済み・送信中の配信は、いま使っている版のままです。"
        confirmLabel="この版に戻す"
        busy={reverting}
        error={revertError}
        onConfirm={() => void doRevert()}
        onCancel={() => {
          if (reverting) return
          setRevertTarget(null)
          setRevertError('')
        }}
      />
    </div>
  )
}
