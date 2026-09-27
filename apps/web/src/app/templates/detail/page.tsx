'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Drawer from '@/components/shared/drawer'
import HelpTip from '@/components/shared/help-tip'
import { ActionCell, DataTable, TableHeadRow, TableStateRow, Td, Th } from '@/components/shared/table'
import TargetMissing from '@/components/shared/target-missing'
import VersionCompare from '@/components/shared/version-compare'
import VersionHistory, { type HistoryVersion } from '@/components/shared/version-history'
import { usePageTitle } from '@/components/shell/page-chrome'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { templateDeleteDescription } from '../template-delete-message'
import { messageTypeText } from '../template-message-type'

interface Usage {
  autoReplies: Array<{ id: string; keyword: string; templateVersion: number | null }>
  automations: Array<{ id: string; name: string; eventType: string }>
  scenarioSteps: Array<{ scenarioId: string; scenarioName: string; stepId: string; stepOrder: number; templateVersion: number | null }>
  reminderSteps: Array<{ reminderId: string; reminderName: string; stepId: string }>
  richMenuAreas: Array<{ groupId: string; groupName: string; pageName: string; areaId: string; label: string | null }>
  trackedLinks: Array<{ id: string; name: string }>
  /** 467: 一斉配信の参照（送った時の版のまま）。来ない古い応答では空扱い。 */
  broadcasts?: Array<{ broadcastId: string; title: string; status: string; scheduledAt: string | null; templateVersionNumber: number | null }>
}

interface TemplateVersionItem {
  versionNumber: number
  status: 'in_use' | 'reserved' | 'past'
  messageType: string
  messageContent: string
  effectiveFrom: string | null
  createdAt: string
}

/** 使っている版の表示。無い版番号はでっち上げず「—」。 */
function versionText(version: number | null): string {
  return version === null || version === undefined ? '—' : `第${version}版`
}

/** 一斉配信の状態の札。予約済みは待っている途中、送信済みは終わり。 */
function broadcastStatusText(status: string): string {
  if (status === 'scheduled') return '予約済み'
  if (status === 'sending') return '送信中'
  if (status === 'sent') return '送信済み'
  return '下書き'
}

function TemplateDetailInner() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const [template, setTemplate] = useState<{
    id: string
    name: string
    category: string | null
    messageType: string
    messageContent: string
    createdAt: string
    updatedAt: string
    publishedVersion: number
    draftRevision: number
  } | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  // 版の履歴は欄を開いたときに読む。一覧と同時に読むと開くのが遅くなる。
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<TemplateVersionItem[] | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState('')
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [comparing, setComparing] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [revertError, setRevertError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [missing, setMissing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  /*
   * N-144: 編集・削除APIは owner/admin だけ。staff へは閲覧だけ残し、
   * 押すと 403 になる口は出さない。
   */
  const [canMutateTemplates] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())
  usePageTitle(template?.name ?? null)

  const reload = useCallback(async () => {
    setMissing(false)
    setError('')
    setTemplate(null)
    setUsage(null)
    setVersions(null)
    setSelectedVersion(null)
    setComparing(false)
    setLoading(true)
    try {
      const detail = await api.templates.get(id)
      if (detail.success) {
        setTemplate(detail.data)
        setUsage(detail.data.usedBy)
      } else {
        setError('テンプレートを読み込めませんでした。もう一度お試しください。')
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
  }, [id])

  const loadVersions = useCallback(async () => {
    if (!id) return
    setVersionsLoading(true)
    setVersionsError('')
    try {
      const res = await api.templates.versions(id)
      if (res.success) {
        setVersions(res.data)
        setSelectedVersion((current) => {
          if (current !== null && res.data.some((v) => v.versionNumber === current)) return current
          const inUse = res.data.find((v) => v.status === 'in_use')
          return inUse ? inUse.versionNumber : (res.data[0]?.versionNumber ?? null)
        })
      } else {
        setVersionsError('版の履歴を読み込めませんでした。もう一度お試しください。')
      }
    } catch {
      setVersionsError('版の履歴を読み込めませんでした。もう一度お試しください。')
    } finally {
      setVersionsLoading(false)
    }
  }, [id])

  const openHistory = useCallback(() => {
    setHistoryOpen(true)
    setComparing(false)
    void loadVersions()
  }, [loadVersions])

  const doRevert = useCallback(async () => {
    if (reverting || selectedVersion === null || !template) return
    setReverting(true)
    setRevertError('')
    try {
      const res = await api.templates.revert(id, {
        versionNumber: selectedVersion,
        expectedVersion: template.publishedVersion,
      })
      if (!res.success) throw new Error(res.error)
      setRevertOpen(false)
      setComparing(false)
      await reload()
      await loadVersions()
    } catch (caught) {
      setRevertError(
        caught instanceof ApiError && caught.status === 409
          ? 'ほかの人が先に公開しました。開き直して確認してください。'
          : 'この版に戻せませんでした。状態を読み直してから、もう一度お試しください。',
      )
    } finally {
      setReverting(false)
    }
  }, [id, reverting, selectedVersion, template, reload, loadVersions])

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    void reload()
  }, [id, reload])

  const broadcastRefs = usage?.broadcasts ?? []
  const usageCount = usage
    ? usage.autoReplies.length
      + usage.automations.length
      + usage.scenarioSteps.length
      + usage.reminderSteps.length
      + usage.richMenuAreas.length
      + usage.trackedLinks.length
      + broadcastRefs.length
    : 0
  // 予約済み・送信中の配信で使うものは消せない（API も 409 で止める）。
  const blockingBroadcasts = broadcastRefs.filter(
    (b) => b.status === 'scheduled' || b.status === 'sending',
  )

  /**
   * 削除の確認。ブラウザの `confirm()` では、何が止まり・何が残り・
   * 戻せるのかを本文で読ませられず、画像比較にも写らなかった。
   * 共通の `ConfirmDialog` へ移した（設計 `H2S1T4`）。
   */
  const remove = async () => {
    // 押している間は受け付けない。二度押しの2回目は404になり、
    // 消えているのに「削除できませんでした」と出る。
    if (deleting) return
    // 使用中は消さない。使用先を差し替えてからにする。
    if (usageCount > 0 || !template) return
    setDeleting(true)
    setDeleteError('')
    setError('')
    try {
      const res = await api.templates.delete(id)
      if (!res.success) throw new Error(res.error)
      setDeleteOpen(false)
      router.push('/templates')
    } catch {
      // 生のAPIエラーは運用者に読めないので、窓の中に運用の言葉で出す。
      setDeleteError('このテンプレートを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

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

  const body = template?.messageContent ?? ''
  // 自動応答はキーワード、シナリオは「シナリオ名 ／ ステップN」で見せる。
  // どこを直せばよいかが、名前だけだと分からないため。
  /*
   * 行の鍵は ID で持つ。名前だと同名が2つあるときに鍵が重なり、
   * React の警告・誤表示の種になる（#497 軽3）。
   */
  const usageRows = [
    ...(usage?.autoReplies ?? []).map((u) => ({
      key: `auto-reply-${u.id}`,
      kind: '自動応答',
      name: u.keyword,
      version: versionText(u.templateVersion ?? null),
      status: null as string | null,
      href: `/auto-replies/edit?id=${u.id}`,
    })),
    ...(usage?.scenarioSteps ?? []).map((u) => ({
      key: `scenario-step-${u.stepId}`,
      kind: 'シナリオ配信',
      name: `${u.scenarioName} ／ ステップ${u.stepOrder}`,
      version: versionText(u.templateVersion ?? null),
      status: null as string | null,
      href: `/scenarios/detail?id=${u.scenarioId}`,
    })),
    ...(usage?.automations ?? []).map((u) => ({
      key: `automation-${u.id}`,
      kind: 'オートメーション',
      name: u.name,
      version: '—',
      status: null as string | null,
      // 旧形式のオートメーションには開ける画面が無い
      // （/automations は新形式のみ、/automations/drafts は別ID空間）。
      href: null as string | null,
    })),
    ...(usage?.reminderSteps ?? []).map((u) => ({
      key: `reminder-step-${u.reminderId}-${u.stepId}`,
      kind: 'リマインダ',
      name: u.reminderName,
      version: '—',
      status: null as string | null,
      href: `/reminders/edit?id=${u.reminderId}`,
    })),
    ...(usage?.richMenuAreas ?? []).map((u) => ({
      key: `rich-menu-${u.groupId}-${u.areaId}`,
      kind: 'リッチメニュー',
      name: `${u.groupName} ／ ${u.pageName}${u.label ? ` ／ ${u.label}` : ''}`,
      version: '—',
      status: null as string | null,
      href: `/rich-menus/edit?id=${u.groupId}`,
    })),
    ...(usage?.trackedLinks ?? []).map((u) => ({
      key: `tracked-link-${u.id}`,
      kind: '流入リンク',
      name: u.name,
      version: '—',
      status: null as string | null,
      href: `/inflow-links/detail?id=${u.id}`,
    })),
    // 467: 一斉配信は参照表から出す。送った配信は送った時の版のまま。
    ...broadcastRefs.map((u) => ({
      key: `broadcast-${u.broadcastId}`,
      kind: '一斉配信',
      name: u.title,
      version: versionText(u.templateVersionNumber),
      status: broadcastStatusText(u.status),
      href: u.status === 'scheduled'
        ? `/broadcasts/reserved?id=${u.broadcastId}`
        : `/broadcasts/detail?id=${u.broadcastId}`,
    })),
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div data-design="Head" className="flex flex-wrap items-center justify-between gap-3">
        <nav data-design="Crumb" className="text-ink-faint text-xs">
          <Link href="/templates" className="hover:underline">
            テンプレート
          </Link>
          <span className="mx-1.5">/</span>
          <span>詳細</span>
        </nav>
        {canMutateTemplates && (
          <Button href={`/templates/edit?id=${id}`} variant="primary">
            テンプレートを編集
          </Button>
        )}
      </div>

      {loading || !template ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
          <div data-design="Left" className="min-w-0 flex-1 space-y-4">
            <section className="bg-canvas rounded-card border-hairline border p-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-ink text-sm font-semibold">本文</p>
                <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-[11px]">
                  {messageTypeText(template.messageType)}
                </span>
                {template.category && (
                  <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-[11px]">
                    {template.category}
                  </span>
                )}
              </div>
              <pre className="bg-canvas-sunken text-ink-secondary mt-3 overflow-x-auto rounded p-3 text-xs whitespace-pre-wrap">
                {body}
              </pre>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <p className="text-ink mb-3 flex items-center gap-1 text-sm font-semibold">
                使われている場所
                <HelpTip label="使われている場所の説明">
                  消す・変える前に、使っている配信・シナリオ・自動応答を確かめられます。使っている版は利用先が使い始めたときの版で、送った配信は送った時の版のまま残ります。
                </HelpTip>
              </p>
              <DataTable>
                <colgroup>
                  <col />
                  <col className="w-24" />
                  <col className="w-20" />
                  <col className="w-24" />
                  <col className="w-16" />
                </colgroup>
                <thead>
                  <TableHeadRow>
                    <Th>使っている所</Th>
                    <Th>種類</Th>
                    <Th>使っている版</Th>
                    <Th>状態</Th>
                    <Th><span className="sr-only">操作</span></Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {usageRows.length === 0 ? (
                    <TableStateRow
                      colSpan={5}
                      kind="empty"
                      title="どこからも呼ばれていません"
                      description="使われると、ここに並びます。"
                    />
                  ) : (
                    usageRows.map((u) => (
                      <tr key={u.key}>
                        <Td>
                          <span className="block truncate" title={u.name}>
                            {u.name}
                          </span>
                        </Td>
                        <Td>
                          <span className="block truncate" title={u.kind}>
                            {u.kind}
                          </span>
                        </Td>
                        <Td>{u.version}</Td>
                        <Td>
                          {u.status === null ? (
                            '—'
                          ) : (
                            <Chip
                              tone={
                                u.status === '予約済み'
                                  ? 'warn'
                                  : u.status === '送信中'
                                    ? 'info'
                                    : 'neutral'
                              }
                            >
                              {u.status}
                            </Chip>
                          )}
                        </Td>
                        <ActionCell>
                          {u.href ? (
                            <Link href={u.href} className="text-action text-xs hover:underline">
                              開く
                            </Link>
                          ) : (
                            <span className="text-ink-faint text-xs">開ける画面がありません</span>
                          )}
                        </ActionCell>
                      </tr>
                    ))
                  )}
                </tbody>
              </DataTable>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <p className="text-ink mb-3 flex items-center gap-1 text-sm font-semibold">
                版の履歴
                <HelpTip label="版の履歴の説明">
                  公開するたびに版が1つ増え、前の版は変わりません。この版に戻すは、その中身で新しい版を作ります。
                </HelpTip>
              </p>
              <Button variant="secondary" onClick={openHistory}>
                版の履歴を見る
              </Button>
            </section>

            {canMutateTemplates && (
              <section className="border-danger-bg bg-canvas rounded-card border p-5">
                <p className="text-danger text-sm font-semibold">このテンプレートを削除する</p>
                <p className="text-ink-faint mt-1 text-xs leading-relaxed">
                  {blockingBroadcasts.length > 0
                    ? `予約済み・送信中の配信${blockingBroadcasts.length}件で使われているため削除できません。配信を取り消すか、差し替えてください。`
                    : usageCount > 0
                      ? `${usageCount}か所で使われています。先に上の使用先を差し替えてください。`
                      : 'どこからも呼ばれていないので、削除しても他の画面に影響しません。'}
                </p>
                <button
                  onClick={() => { setDeleteError(''); setDeleteOpen(true) }}
                  disabled={usageCount > 0}
                  title={usageCount > 0 ? '使用先を差し替えると削除できます' : undefined}
                  className="text-danger hover:bg-danger-bg rounded-control mt-3 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {usageCount > 0 ? '使用中のため削除できません' : 'テンプレートを削除'}
                </button>
              </section>
            )}
          </div>

          <div data-design="Right" className="w-full shrink-0 space-y-4 xl:w-80">
            <section className="bg-canvas rounded-card border-hairline border p-4">
              <p className="text-ink text-sm font-semibold">届き方</p>
              <p className="text-ink-faint mt-0.5 mb-2 text-xs">お客様の画面での見え方です。</p>
              <div className="bg-canvas-sunken rounded-card p-3">
                <p className="text-ink-faint mb-1 text-xs">然-NEN-</p>
                <p className="text-ink rounded-2xl bg-white px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
                  {body}
                </p>
              </div>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-4">
              <p className="text-ink text-sm font-semibold">このテンプレートについて</p>
              <dl className="mt-2 space-y-1.5 text-xs">
                <Row label="分類" value={template.category || '未分類'} />
                <Row
                  label="種類"
                  value={messageTypeText(template.messageType)}
                />
                <Row label="文字数" value={`${body.length}文字`} />
                {/* 詳細の口は作成日・更新日を返している（#497 軽4）。 */}
                <Row label="作成" value={formatDateTime(template.createdAt)} />
                <Row label="最終更新" value={formatDateTime(template.updatedAt)} />
                <Row label="使われている数" value={`${usageCount}か所`} />
              </dl>
            </section>

            <Link
              href="/templates"
              className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken block border px-4 py-2 text-center text-sm font-medium"
            >
              一覧へ戻る
            </Link>
          </div>
        </div>
      )}

      <div data-design-node="M9cij">
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
        />
      </div>

      <Drawer
        open={historyOpen}
        title="版の履歴"
        description="公開するたびに版が1つ増えます。前の版は変わりません。この版に戻すは、その中身で新しい版を作ります。"
        onClose={() => {
          if (reverting) return
          setHistoryOpen(false)
          setComparing(false)
        }}
      >
        {versionsLoading ? (
          <p className="text-ink-faint text-xs">読み込み中...</p>
        ) : versionsError ? (
          <div>
            <p className="text-ink-secondary text-xs">{versionsError}</p>
            <Button variant="secondary" onClick={() => void loadVersions()} className="mt-2">
              もう一度読み込む
            </Button>
          </div>
        ) : (
          <>
            <VersionHistory
              versions={(versions ?? []).map((v): HistoryVersion => ({
                versionNumber: v.versionNumber,
                title: `第${v.versionNumber}版`,
                status: v.status,
                statusNote:
                  v.status === 'reserved' && v.effectiveFrom
                    ? `${formatDateTime(v.effectiveFrom)}から使う`
                    : v.status === 'in_use'
                      ? 'いま使っている'
                      : null,
                summary: v.messageContent.split('\n')[0] ?? null,
                at: formatDateTime(v.createdAt),
              }))}
              selectedVersionNumber={selectedVersion}
              onSelect={(n) => {
                setSelectedVersion(n)
                setComparing(false)
              }}
              compareLabel={
                selectedVersion === null ? '比べる' : `第${selectedVersion}版と比べる`
              }
              onCompare={() => setComparing(true)}
              revertLabel={
                selectedVersion === null ? '戻す' : `第${selectedVersion}版に戻す`
              }
              onRevert={() => {
                setRevertError('')
                setRevertOpen(true)
              }}
              canRevert={
                canMutateTemplates
                && selectedVersion !== null
                && (versions ?? []).find((v) => v.versionNumber === selectedVersion)?.status !== 'in_use'
              }
              revertDisabledReason={
                !canMutateTemplates
                  ? '編集の権限がありません'
                  : 'いま使っている版です'
              }
              busy={reverting}
            />
            {comparing && selectedVersion !== null ? (
              <CompareBlock versions={versions ?? []} selectedVersion={selectedVersion} />
            ) : null}
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={revertOpen}
        title={`第${selectedVersion}版に戻しますか？`}
        description="過去の版は変わりません。その中身で新しい版を作ります。予約済み・送信中の配信は、いま使っている版のままです。"
        confirmLabel="この版に戻す"
        busy={reverting}
        error={revertError}
        onConfirm={() => void doRevert()}
        onCancel={() => {
          if (reverting) return
          setRevertOpen(false)
          setRevertError('')
        }}
      />
    </div>
  )
}

/*
 * 日時の表示（一覧と同じく日本時間）。来ない・壊れているときは
 * 「—」にし、取れていないのを空欄や変な日付にしない。
 */
function formatDateTime(iso: string): string {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-faint shrink-0">{label}</dt>
      <dd className="text-ink min-w-0 truncate text-right">{value}</dd>
    </div>
  )
}

/** 選んだ版といま使っている版を比べる。版そのものは変えない。 */
function CompareBlock({
  versions,
  selectedVersion,
}: {
  versions: TemplateVersionItem[]
  selectedVersion: number
}) {
  const selected = versions.find((v) => v.versionNumber === selectedVersion)
  const inUse = versions.find((v) => v.status === 'in_use')
  if (!selected || !inUse) return null
  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <p className="text-ink mb-2 text-xs font-semibold">
        比べる（いま使っている第{inUse.versionNumber}版 ← 第{selected.versionNumber}版）
      </p>
      <VersionCompare before={inUse.messageContent} after={selected.messageContent} />
    </div>
  )
}

export default function TemplateDetailPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <TemplateDetailInner />
    </Suspense>
  )
}
