'use client'

/*
 * ★V8 テンプレートの詳細（一から書いた画面・2026-10-07）。
 * Pencil：詳細（未公開の変更あり）`UTbi1`、削除できない窓 `Z0g3si`、公開の確かめ `cuR8I`、
 * 使っていないときの削除の確認 `V6JFnd`。
 *
 * 型は「作る」と同じ頭（戻る・名前・種類とフォルダ）＋左右の列。下の帯は無い（詳細なので）。
 * 動き（読み込み・公開・この版に戻す・削除の安全・権限）は今の画面（app/templates/detail）と同じ。
 * 受け付ける指定・呼ぶ API は BEHAVIOR.md。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CircleAlert, Copy, ExternalLink, GitCompare, List, Pencil, RotateCcw, Send, Upload } from 'lucide-react'
import { validateFlexContent } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import LinePreview from '@/components/shared/line-preview'
import TargetMissing from '@/components/shared/target-missing'
import FlexPreviewComponent from '@/components/flex-preview'
import {
  buildUsageRows,
  insertionNames,
  isTemplateDetailData,
  lineChanges,
  messageTypeText,
  publishRowState,
  shortStamp,
  templateDeleteDescription,
  type TemplateDetailData,
  type TemplateVersionItem,
  type UsageRow,
} from './model'
import styles from './detail.module.css'

/** 表にまず見せる行数。残りは「ほか N か所を見る」で開く。 */
const USAGE_VISIBLE = 4
/** 窓にまず見せる行数（公開は4・削除できないは2。絵どおり）。 */
const PUBLISH_VISIBLE = 4
const BLOCKED_VISIBLE = 2

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
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState('')
  const usageRef = useRef<HTMLElement>(null)

  /* N-144：編集・公開・削除の口は owner/admin だけ。閲覧のみには押せない操作を置かない（隠す）。 */
  const [canMutate] = useState(() => (typeof window === 'undefined' ? true : isOwnerOrAdmin()))
  usePageTitle(template?.name ?? null)

  const loadVersions = useCallback(async () => {
    if (!id) return
    setVersionsError('')
    try {
      const res = await api.templates.versions(id)
      if (res.success) setVersions(res.data)
      else setVersionsError('版の履歴を読み込めませんでした。もう一度お試しください。')
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
      if (detail.success && isTemplateDetailData(detail.data)) setTemplate(detail.data)
      else if (!detail.success) setError('テンプレートを読み込めませんでした。もう一度お試しください。')
      else setMissing(true)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) setMissing(true)
      else setError('テンプレートを読み込めませんでした。もう一度お試しください。')
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
      setFolderName(res.data.find((folder) => folder.id === template?.folderId)?.name ?? null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [selectedAccountId, template?.folderId])

  useEffect(() => {
    if (!selectedAccountId || !template) return
    let cancelled = false
    api.templates.list(undefined, selectedAccountId).then((res) => {
      if (cancelled || !res.success) return
      setMonthlySends(res.data.find((item) => item.id === template.id)?.monthlySendCount ?? null)
    }).catch(() => setMonthlySends(null))
    return () => { cancelled = true }
  }, [selectedAccountId, template])

  const usageRows = useMemo(() => buildUsageRows(template?.usedBy ?? null), [template])
  const usageCount = usageRows.length
  const latestCount = usageRows.filter((row) => !row.fixed).length
  const fixedCount = usageCount - latestCount
  const fixedBroadcasts = (template?.usedBy?.broadcasts ?? []).filter(
    (b) => (b.referenceMode === 'fixed' || b.templateVersionNumber !== null) && (b.status === 'scheduled' || b.status === 'sending'),
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
      const res = await api.templates.revert(id, { versionNumber: revertTarget, expectedVersion: template.publishedVersion })
      if (!res.success) throw new Error(res.error)
      setRevertTarget(null)
      setCompareTarget(null)
      await reload()
    } catch (caught) {
      setRevertError(caught instanceof ApiError && caught.status === 409
        ? 'ほかの人が先に公開しました。開き直して確認してください。'
        : 'この版に戻せませんでした。状態を読み直してから、もう一度お試しください。')
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

  /*
   * 複製：公開済みの版（いま使っている版）の中身で新しいテンプレートを作る。
   * 直しかけの下書きは写さない（公開前の中身が別の名前で出回らないように）。
   * 公開済みの版が無いときは押せる口を出さない。
   */
  const duplicate = useCallback(async () => {
    if (duplicating || !template || !inUseVersion || !selectedAccountId) return
    setDuplicating(true)
    setDuplicateError('')
    try {
      const res = await api.templates.create({
        accountId: selectedAccountId,
        name: `${template.name}のコピー`,
        category: template.category,
        messageType: inUseVersion.messageType ?? template.messageType,
        messageContent: inUseVersion.messageContent,
        folderId: template.folderId ?? null,
        ...(inUseVersion.carouselActions !== undefined ? { carouselActions: inUseVersion.carouselActions } : {}),
        ...(inUseVersion.carouselTapLimitMode === 'none' || inUseVersion.carouselTapLimitMode === 'once' ? { carouselTapLimitMode: inUseVersion.carouselTapLimitMode } : {}),
        ...(inUseVersion.carouselTapLimitText !== undefined ? { carouselTapLimitText: inUseVersion.carouselTapLimitText } : {}),
      })
      if (!res.success) throw new Error(res.error)
      router.push(`/templates/detail?id=${encodeURIComponent(res.data.id)}`)
    } catch {
      setDuplicateError('複製できませんでした。もう一度お試しください。')
    } finally {
      setDuplicating(false)
    }
  }, [duplicating, template, inUseVersion, selectedAccountId, router])

  const openDelete = useCallback(() => {
    setDeleteError('')
    if (usageCount > 0) setBlockedOpen(true)
    else setDeleteOpen(true)
  }, [usageCount])

  const showAllAndScroll = useCallback(() => {
    setBlockedOpen(false)
    setShowAllUsages(true)
    window.requestAnimationFrame(() => usageRef.current?.scrollIntoView({ block: 'start' }))
  }, [])

  if (!id) {
    return <TargetMissing kind="unspecified" title="見るテンプレートが指定されていません" description="一覧から、見たいテンプレートを選び直してください。" backHref="/templates" backLabel="テンプレートの一覧へ戻る" />
  }
  if (missing || (!error && !loading && !template)) {
    return <TargetMissing kind="not-found" title="このテンプレートは見つかりません" description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。" backHref="/templates" backLabel="テンプレートの一覧へ戻る" />
  }
  if (error || (!loading && !template)) {
    return <TargetMissing kind="error" title="テンプレートを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => void reload()} />
  }

  const backLink = <Link href="/templates" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />テンプレートへ</Link>
  if (loading || !template) {
    return (
      <div className={styles.page} data-design-node="UTbi1">
        <div className={styles.loadingHead}>{backLink}</div>
        <p className={styles.loading} role="status">読み込み中…</p>
      </div>
    )
  }

  const editHref = template.question
    ? `/templates/questions/new?id=${encodeURIComponent(id)}`
    : `/templates/edit?id=${encodeURIComponent(id)}`
  const folderLabel = folderName ?? (template.folderId ? template.category : '未分類')
  const insertions = insertionNames(draftContent)
  const visibleUsages = showAllUsages ? usageRows : usageRows.slice(0, USAGE_VISIBLE)
  const compareBefore = compareTarget === 'draft' ? inUseVersion?.messageContent ?? null : (versions ?? []).find((v) => v.versionNumber === compareTarget)?.messageContent ?? null
  const compareAfter = compareTarget === 'draft' ? draftContent : inUseVersion?.messageContent ?? null
  const publishDraftText = template.publishedVersion > 0
    ? `公開すると、使っている ${usageCount} か所のうち「いまの版」を使う ${latestCount} か所に新しい内容が使われます。`
      + (fixedBroadcasts > 0
        ? `版を決めて予約した一斉配信 ${fixedBroadcasts} 件は、決めた版のまま送ります。`
        : fixedCount > 0 ? `版を決めた ${fixedCount} か所は、決めた版のまま送ります。` : '')
    : '公開すると配信で選べるようになります。公開するまで使っている所は変わりません。'
  const menuItems: ActionMenuItem[] = [
    ...(usageCount > USAGE_VISIBLE ? [{ id: 'all-usages', label: '使っている所をすべて見る', onSelect: showAllAndScroll }] : []),
    { id: 'delete', label: '削除する', tone: 'danger' as const, dividerBefore: usageCount > USAGE_VISIBLE, onSelect: openDelete },
  ]
  const flexError = template.messageType === 'flex' ? validateFlexContent('flex', draftContent) : null

  const usageRow = (row: UsageRow) => (
    <div key={row.key} className={styles.usageRow}>
      <span className={styles.usageKind}>{row.kind}</span>
      {row.href
        ? <Link href={row.href} className={styles.usageName} title={row.name}>{row.name}</Link>
        : <span className={styles.usageNameQuiet} title={row.name}>{row.name}</span>}
      <span className={row.fixed ? styles.usageVersionFixed : styles.usageVersion} title={row.version}>{row.version}</span>
      <span className={styles.usageState}>{row.status ?? '—'}</span>
      {row.href
        ? <Link href={row.href} className={styles.ghostButton}><ExternalLink size={14} aria-hidden="true" />開く</Link>
        : <span className={styles.ghostSpacer} aria-hidden="true" />}
    </div>
  )

  const compareBox = compareTarget !== null && compareBefore !== null && compareAfter !== null ? (
    <ChangeBox
      title={compareTarget === 'draft'
        ? `変わるところ（版${inUseVersion?.versionNumber ?? '—'} → 下書き）`
        : `比べる（版${compareTarget} → いま使っている版${inUseVersion?.versionNumber ?? ''}）`}
      before={compareBefore}
      after={compareAfter}
    />
  ) : null

  const side = (
    <div className={styles.side}>
      {canMutate ? (
        <div className={styles.sideActions}>
          <Button href={`/broadcasts/new?templatePicker=1&templateId=${encodeURIComponent(id)}`} variant="secondary">
            <Send size={14} aria-hidden="true" />
            一斉配信で使う
          </Button>
          {inUseVersion ? (
            <Button variant="secondary" onClick={() => void duplicate()} busy={duplicating} busyLabel="複製しています…">
              <Copy size={14} aria-hidden="true" />
              複製する
            </Button>
          ) : null}
          <RowMenu className={styles.moreButton} label="そのほかの操作" menuLabel={`テンプレート「${template.name}」の操作`} items={menuItems} />
        </div>
      ) : null}
      {duplicateError ? <p className={styles.errorText} role="alert">{duplicateError}</p> : null}
      <section className={styles.aboutBox} aria-label="このテンプレートについて">
        <h2 className={styles.aboutTitle}>このテンプレートについて</h2>
        <dl className={styles.aboutList}>
          <div className={styles.aboutRow}><dt>種類</dt><dd>{messageTypeText(template.messageType)}</dd></div>
          <div className={styles.aboutRow}><dt>フォルダ</dt><dd>{folderLabel}</dd></div>
          <div className={styles.aboutRow}><dt>今月送った数</dt><dd>{monthlySends === undefined ? '読み込み中…' : monthlySends === null ? '—' : `${monthlySends.toLocaleString('ja-JP')}通`}</dd></div>
          <div className={styles.aboutRow}><dt>差し込み</dt><dd title={insertions.join('・')}>{insertions.length > 0 ? insertions.join('・') : 'なし'}</dd></div>
        </dl>
      </section>
      {flexError ? (
        <div role="alert" className={styles.flexError}>
          <p className={styles.flexErrorTitle}>{flexError}</p>
          <p className={styles.flexErrorNote}>
            このままでは公開できません。
            {canMutate ? <Link href={editHref} className={styles.inlineLink}>再編集で直してください。</Link> : 'オーナー・管理者に再編集を依頼してください。'}
          </p>
        </div>
      ) : (
        <LinePreview accountName="然 - NEN -" note="受け取る人のLINEでの見え方です。{ } の差し込みは、送るときに受け取る人ごとの値に変わります。">
          {template.messageType === 'flex' ? <FlexPreviewComponent content={draftContent} /> : (
            <div className={styles.talkRow}>
              <span className={styles.talkIcon} aria-hidden="true">然</span>
              <div className={styles.talkCol}>
                <span className={styles.talkName}>然 - NEN -</span>
                <div className={styles.talkBubbleRow}>
                  <p className={styles.talkBubble}>{draftContent}</p>
                  <span className={styles.talkTime}>18:00</span>
                </div>
              </div>
            </div>
          )}
        </LinePreview>
      )}
    </div>
  )

  return (
    <div className={styles.page} data-design-node="UTbi1">
      <DetailFrame
        title={template.name}
        identity={backLink}
        description={[messageTypeText(template.messageType), folderLabel, `更新 ${shortStamp(template.updatedAt)}`].join('・')}
        preview={side}
      >
        {canMutate ? null : <p className={styles.roBand} role="note">閲覧のみで見ています。編集・公開・削除は管理者に頼んでください。</p>}
        {template.hasDraft ? (
          <div className={styles.draftBand} role="status">
            <CircleAlert size={18} aria-hidden="true" className={styles.draftIcon} />
            <div className={styles.draftText}>
              <p className={styles.draftTitle}>{template.publishedVersion > 0 ? '未公開の変更があります' : 'まだ公開していません'}</p>
              <p className={styles.draftNote}>{publishDraftText}</p>
            </div>
            {canMutate ? (
              <>
                {inUseVersion ? (
                  <Button variant="secondary" onClick={() => setCompareTarget((current) => (current === 'draft' ? null : 'draft'))} aria-pressed={compareTarget === 'draft'}>
                    <GitCompare size={14} aria-hidden="true" />
                    比べる
                  </Button>
                ) : null}
                <Button variant="primary" onClick={() => { setPublishError(''); setPublishOpen(true) }}>
                  <Upload size={14} aria-hidden="true" />
                  公開する
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        {compareTarget === 'draft' ? compareBox : null}

        <section className={styles.card} aria-label="本文">
          <div className={styles.cardHead}>
            <div className={styles.cardTitles}>
              <h2 className={styles.cardTitle}>{template.hasDraft ? '本文（下書き）' : '本文'}</h2>
              <p className={styles.cardNote}>{'{ } は差し込み。受け取る人ごとに変わります。'}</p>
            </div>
            {canMutate ? (
              <Button href={editHref} variant="secondary">
                <Pencil size={14} aria-hidden="true" />
                編集する
              </Button>
            ) : null}
          </div>
          <div className={styles.bodyBox}>{draftContent}</div>
        </section>

        <section className={styles.card} aria-label="使っている所" ref={usageRef}>
          <div className={styles.cardTitles}>
            <h2 className={styles.cardTitle}>使っている所</h2>
            <p className={styles.cardNote}>
              {usageCount > 0
                ? `${usageCount} か所。「いまの版」を使う ${latestCount} か所に反映されます${fixedCount > 0 ? `（版を決めた ${fixedCount} か所は変わりません）` : ''}。`
                : 'どこからも呼ばれていません。使われると、ここに並びます。'}
            </p>
          </div>
          {usageCount > 0 ? (
            <>
              {visibleUsages.map(usageRow)}
              {usageCount > USAGE_VISIBLE && !showAllUsages ? (
                <div className={styles.moreRow}>
                  <button type="button" className={styles.ghostButton} onClick={() => setShowAllUsages(true)}>ほか {usageCount - USAGE_VISIBLE} か所を見る</button>
                </div>
              ) : null}
            </>
          ) : <p className={styles.empty}>まだ使われていません</p>}
        </section>

        <section className={styles.card} aria-label="版の履歴">
          <div className={styles.cardTitles}>
            <h2 className={styles.cardTitle}>版の履歴</h2>
            <p className={styles.cardNote}>戻すと、その版を下書きとして作り直します。公開するまで使っている所は変わりません。</p>
          </div>
          {versions === null && !versionsError ? <p className={styles.empty} role="status">読み込み中…</p> : versionsError ? (
            <div className={styles.versionError}>
              <p className={styles.errorText}>{versionsError}</p>
              <Button variant="secondary" onClick={() => void loadVersions()}>もう一度読み込む</Button>
            </div>
          ) : (
            <>
              {template.hasDraft ? (
                <div className={styles.versionDraft}>
                  <span className={styles.versionNum}>版{nextVersionNumber}</span>
                  <div className={styles.versionText}>
                    <p className={styles.versionLabel}>下書き（まだ公開していない）</p>
                    <p className={styles.versionMeta}>{shortStamp(template.updatedAt)}</p>
                  </div>
                  {inUseVersion ? (
                    <div className={styles.versionActions}>
                      <Button variant="secondary" onClick={() => setCompareTarget((current) => (current === 'draft' ? null : 'draft'))}>いまの版と比べる</Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {(versions ?? []).map((version) => (
                <div key={version.versionNumber} className={version.status === 'in_use' ? styles.versionInUse : styles.versionPast}>
                  <span className={styles.versionNum}>版{version.versionNumber}</span>
                  <div className={styles.versionText}>
                    <p className={styles.versionLabel}>
                      {version.status === 'in_use' ? 'いま使っている版'
                        : version.status === 'reserved' ? `予約した版（${version.effectiveFrom ? `${shortStamp(version.effectiveFrom)}から使う` : '予約中'}）` : '前の版'}
                    </p>
                    <p className={styles.versionMeta}>{shortStamp(version.createdAt)}</p>
                  </div>
                  {version.status !== 'in_use' ? (
                    <div className={styles.versionActions}>
                      {inUseVersion ? (
                        <Button variant="secondary" onClick={() => setCompareTarget((current) => (current === version.versionNumber ? null : version.versionNumber))}>比べる</Button>
                      ) : null}
                      {canMutate ? (
                        <Button variant="secondary" onClick={() => { setRevertError(''); setRevertTarget(version.versionNumber) }}><RotateCcw size={14} aria-hidden="true" />この版に戻す</Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
              {typeof compareTarget === 'number' ? compareBox : null}
            </>
          )}
        </section>
      </DetailFrame>

      {/* 公開の確かめ（cuR8I）：反映される所と変わるところを見せてから公開する。 */}
      <Dialog
        open={publishOpen}
        designNode="cuR8I"
        designWidth={640}
        designTop={226}
        title={`「${template.name}」を公開する`}
        description={`公開すると、下のうち「いまの版」を使う所で新しい内容（版${nextVersionNumber}）が使われます。版を決めた予約と、すでに送ったメッセージは変わりません。`}
        busy={publishing}
        error={publishError}
        onCancel={() => {
          if (publishing) return
          setPublishOpen(false)
          setPublishError('')
        }}
        footer={(
          <div className={styles.dialogFooter}>
            <Button variant="secondary" onClick={() => { setPublishOpen(false); setPublishError('') }} disabled={publishing}>キャンセル</Button>
            <Button variant="primary" onClick={() => void doPublish()} busy={publishing} busyLabel="公開しています…">
              <Upload size={14} aria-hidden="true" />
              {latestCount > 0 ? `公開する（${latestCount} か所に反映）` : '公開する'}
            </Button>
          </div>
        )}
      >
        <div className={styles.dialogBody}>
          {usageCount > 0 ? (
            <div className={styles.dialogList}>
              {usageRows.slice(0, PUBLISH_VISIBLE).map((row) => (
                <div key={row.key} className={styles.dialogRow}>
                  <span className={styles.usageKind}>{row.kind}</span>
                  <span className={styles.dialogName} title={row.name}>{row.name}</span>
                  <span className={styles.dialogState}>{publishRowState(row)}</span>
                </div>
              ))}
              {usageCount > PUBLISH_VISIBLE ? <p className={styles.dialogMore}>ほか {usageCount - PUBLISH_VISIBLE} か所</p> : null}
            </div>
          ) : null}
          {inUseVersion ? (
            <ChangeBox title={`変わるところ（版${inUseVersion.versionNumber} → 版${nextVersionNumber}）`} before={inUseVersion.messageContent} after={draftContent} />
          ) : null}
        </div>
      </Dialog>

      {/* 削除できない（Z0g3si）：使っている所があるうちは消さない。開いて差し替える口と、全部を見る口。 */}
      <Dialog
        open={blockedOpen}
        designNode="Z0g3si"
        designWidth={640}
        designTop={226}
        title={`「${template.name}」はまだ消せません`}
        description={`${usageCount} か所で使われています。消すと、その配信や自動応答が送れなくなるためです。先に別のテンプレートへ差し替えてください。`}
        onCancel={() => setBlockedOpen(false)}
        footer={(
          <div className={styles.dialogFooter}>
            <Button variant="secondary" onClick={() => setBlockedOpen(false)}>閉じる</Button>
            <Button variant="secondary" onClick={showAllAndScroll}><List size={14} aria-hidden="true" />使っている所をすべて見る</Button>
          </div>
        )}
      >
        <div className={styles.dialogList}>
          {usageRows.slice(0, BLOCKED_VISIBLE).map((row) => (
            <div key={row.key} className={styles.blockedRow}>
              <span className={styles.usageKind}>{row.kind}</span>
              <span className={styles.dialogName} title={row.name}>{row.name}</span>
              {row.href
                ? <Link href={row.href} className={styles.ghostButton}><ExternalLink size={14} aria-hidden="true" />開いて差し替える</Link>
                : <span className={styles.dialogState}>開ける画面がありません</span>}
            </div>
          ))}
          {usageCount > BLOCKED_VISIBLE ? <p className={styles.dialogMore}>ほか {usageCount - BLOCKED_VISIBLE} か所</p> : null}
        </div>
      </Dialog>

      {/* 使っていないときの削除の確認（V6JFnd）。 */}
      <ConfirmDialog
        open={deleteOpen && usageCount === 0}
        title={`テンプレート「${template.name}」を削除しますか？`}
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

/** 版の差（－ 消えた行・＋ 増えた行）。同じなら「違いはありません」。 */
function ChangeBox({ title, before, after }: { title: string; before: string; after: string }) {
  const changes = lineChanges(before, after)
  return (
    <div className={styles.changeBox}>
      <p className={styles.changeTitle}>{title}</p>
      {changes.length === 0 ? <p className={styles.changeSame}>違いはありません</p> : changes.map((change, index) => (
        <p key={`${change.kind}-${index}`} className={change.kind === 'removed' ? styles.changeRemoved : styles.changeAdded}>
          {change.kind === 'removed' ? '－ ' : '＋ '}{change.text}
        </p>
      ))}
    </div>
  )
}

/**
 * 型の「作る」の頭（戻る・名前・説明）と左右の列。詳細には保存が無いので下の帯を置かない
 * （型の CreatePage は帯が必須で、帯があると本文が画面の高さで切られるため、枠と頭だけ型から使う）。
 */
function DetailFrame({ title, identity, description, preview, children }: {
  title: string; identity: ReactNode; description: string; preview: ReactNode; children: ReactNode
}) {
  return (
    <PageFrame kind="create">
      <PageHeading title={title} identity={identity} description={description} />
      <div className={styles.split}>
        <div className={styles.content}>{children}</div>
        <aside className={styles.aside}>{preview}</aside>
      </div>
    </PageFrame>
  )
}
