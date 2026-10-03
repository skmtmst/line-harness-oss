'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FlaskConical, History, Rocket, Trash2 } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import ListToolbar from '@/components/shared/list-toolbar'
import { RowActions } from '@/components/shared/row-actions'
import ListState from '@/components/shared/list-state'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
import StatusBadge from '@/components/shared/status-badge'
import KpiCard from '@/components/shared/kpi-card'
import { Tabs } from '@/components/shared/tabs'
import { ActionCell, DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import type { FriendAddRule, FriendAddRuleKind, FriendAddRuleListData } from '@/lib/api'
import { api } from '@/lib/api'
import { useAdminTheme } from '@/lib/use-admin-theme'
import FriendAddListV8 from './list-v8'
import FriendAddRuleEditor from './friend-add-rule-editor'
import FriendAddEditorV8 from './editor-v8'
import { describeFriendAddFailure } from './friend-add-failure'
import { useCursorStack } from './use-cursor-stack'
import { formatNumber } from '@/lib/format'

const KIND_LABELS: Record<FriendAddRuleKind, string> = {
  first_time: 'はじめて友だち追加した人',
  returning: '以前からの友だち・ブロック解除した人',
}

function countText(value: number | null, unit: string) {
  return value === null ? '—' : `${formatNumber(value)}${unit}`
}

function successRate(delivered: number | null, failed: number | null) {
  if (delivered === null || failed === null || delivered + failed === 0) return '成功率 —'
  return `成功率 ${((delivered / (delivered + failed)) * 100).toFixed(1)}%`
}

function deliverySummary(rule: FriendAddRule) {
  // 「何も配信しない」ではメッセージもシナリオも動かない（R261）。
  if (rule.friendKind === 'returning' && rule.definition.returningMode === 'none') {
    return '配信なし（アクションのみ）'
  }
  const message = rule.definition.messageType === 'template'
    ? 'テンプレート'
    : rule.definition.messageType === 'form'
      ? '回答フォーム'
      : rule.definition.messageText ? 'テキスト' : null
  return [message, rule.scenarioName].filter(Boolean).join('＋') || '未取得'
}

/*
 * 流入リンクを1件も選んでいない下書きは、実行側ではどの経路にも
 * 当たらない（「すべての流入経路」ではない）。未完成のしるしとして
 * 「未選択」と出す（R260）。
 */
function routeLabel(rule: FriendAddRule) {
  if (rule.isFallback) return '経路が取れなかったとき'
  return rule.routeNames.join('、') || '未選択'
}

export default function FriendAddSettingsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddSettingsInner />
    </Suspense>
  )
}

function FriendAddSettingsInner() {
  /*
   * ★V8 分岐：一覧（板 `MRhef`）と作る・直す手順（板 `wDzkc`・`h8uNW`・
   * `al47K`・`i1nThZ`・`U8Xm3X`）を `data-theme="v8"` の下で積み替える。
   */
  const theme = useAdminTheme()
  const searchParams = useSearchParams()
  const view = searchParams.get('view')
  if (view === 'new') return theme === 'v8' ? <FriendAddEditorV8 /> : <FriendAddRuleEditor />
  if (view === 'edit') {
    return theme === 'v8'
      ? <FriendAddEditorV8 ruleId={searchParams.get('id') ?? undefined} />
      : <FriendAddRuleEditor ruleId={searchParams.get('id') ?? undefined} />
  }
  return theme === 'v8' ? <FriendAddListV8 /> : <FriendAddSettingsList />
}

function FriendAddSettingsList() {
  usePageTitle('友だち追加時の配信')
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const searchParams = useSearchParams()
  const router = useRouter()
  const kind: FriendAddRuleKind = searchParams.get('kind') === 'returning' ? 'returning' : 'first_time'
  const requestedDeleteId = searchParams.get('delete')
  const [data, setData] = useState<FriendAddRuleListData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // M006: 403 は共通部品の forbidden で出す。HTTP の状態をそのまま渡す。
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<FriendAddRule | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const { cursor, page: cursorPage, canPrev, reset: resetCursor, goPrev, goNext } = useCursorStack()
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const folderKey = useRef(crypto.randomUUID())
  const requestSequence = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
    if (!selectedAccountId) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setErrorStatus(null)
    try {
      // 検索とフォルダ絞りはサーバ側へ送る。取得済みページ内だけに効かせると
      // 21件目以降が検索に出ない。
      const response = await api.friendAddRules.list(selectedAccountId, kind, {
        cursor: cursor ?? undefined,
        limit: 20,
        q: appliedSearch.trim() || undefined,
        folder: folder ?? undefined,
      })
      if (requestId !== requestSequence.current) return
      if (!response.success) {
        setError(response.error)
        setErrorStatus(null)
        setData(null)
        return
      }
      setData(response.data)
    } catch (caught) {
      if (requestId !== requestSequence.current) return
      // M006: 権限・対象なし・重複を「通信を確認して」にまとめない。
      const failure = describeFriendAddFailure(caught, '友だち追加時の配信', 'load')
      setError(failure.message)
      setErrorStatus(failure.status)
      setData(null)
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [appliedSearch, cursor, folder, kind, selectedAccountId])

  useEffect(() => { void load() }, [load])

  useEffect(() => { resetCursor() }, [selectedAccountId, resetCursor])

  // 検索の入力は少し待ってから、巻き戻しと一緒に1回だけサーバへ送る。
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search)
      resetCursor()
    }, 300)
    return () => clearTimeout(timer)
  }, [search, resetCursor])

  const selectFolder = (next: string | null) => {
    setFolder(next)
    resetCursor()
  }

  useEffect(() => {
    if (!requestedDeleteId || !data) return
    setDeleting(data.items.find((item) => item.id === requestedDeleteId) ?? null)
  }, [data, requestedDeleteId])

  /*
   * フォルダ欄の件数はサーバの全ページ合計 (folderCounts)。取得済みページ内
   * で数えると、2ページ目以降があるときに件数が少なく見える。
   */
  const folders = useMemo(() => {
    const counts = new Map<string | null, number>()
    for (const entry of data?.folderCounts ?? []) counts.set(entry.name, entry.count)
    const rows: Array<{ key: string; name: string; count: number }> = []
    for (const option of data?.options.folders ?? []) {
      rows.push({ key: option.name, name: option.name, count: counts.get(option.name) ?? 0 })
    }
    const uncategorized = counts.get(null) ?? 0
    if (uncategorized > 0 || !rows.some((row) => row.name === '未分類')) {
      rows.push({ key: '__uncategorized', name: '未分類', count: uncategorized })
    }
    return rows
  }, [data])

  const createFolder = async () => {
    if (!selectedAccountId || folderBusy) return
    const name = folderName.trim()
    if (!name) return
    setFolderBusy(true)
    setError('')
    try {
      const response = await api.friendAddRules.createFolder(selectedAccountId, name, folderKey.current)
      if (!response.success) {
        setError(response.error)
        return
      }
      folderKey.current = crypto.randomUUID()
      setFolderName('')
      setFolderDialogOpen(false)
      await load()
    } catch (caught) {
      // M006: 重複（409）は名前の変更、403 は権限の確認を案内する。
      setError(describeFriendAddFailure(caught, 'フォルダ', 'create').message)
    } finally {
      setFolderBusy(false)
    }
  }

  // 検索はサーバ側で全ページに効かせる。ここでは表示絞りをしない。
  const visibleItems = useMemo(() => data?.items ?? [], [data])

  const closeDelete = () => {
    setDeleting(null)
    setDeleteError('')
    if (requestedDeleteId) router.replace(`/friend-add-settings?kind=${kind}`)
  }

  const archiveRule = async () => {
    if (!selectedAccountId || !deleting) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const response = await api.friendAddRules.archive(selectedAccountId, deleting.id)
      if (!response.success) {
        setDeleteError('削除できませんでした。設定を確認してください。')
        return
      }
      closeDelete()
      await load()
    } catch (caught) {
      // M006: 権限・対象なしを「通信を確認して」にまとめない。
      setDeleteError(describeFriendAddFailure(caught, '設定', 'delete').message)
    } finally {
      setDeleteBusy(false)
    }
  }

  if (accountLoading || loading) return <ListState kind="loading" title="友だち追加時の配信を読み込んでいます" />
  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINE公式アカウントを選んでください" description={accounts.length ? '上のバーで対象を選ぶと設定を表示します。' : '先にLINE公式アカウントを登録してください。'} />
  }
  if (error) return <ListState kind={errorStatus === 403 ? 'forbidden' : 'error'} title="友だち追加時の配信を表示できませんでした" description={error} onRetry={() => void load()} />

  return (
    <div data-design-node="uLQQc" className="flex min-w-0 flex-col gap-4 text-ink">
      {/*
        作る操作は数字のカードの下・一覧のすぐ上の左。
        たまに見る実行結果は見出しの行の右端に残す。
      */}
      <div data-design="Head" className="flex flex-wrap items-center justify-end gap-2">
        <Button href="/friend-add-settings/runs">実行結果を見る</Button>
      </div>

      {/*
        ★V7：仕組みの説明で、異常ではない。橙の太字の警告帯だと毎回「何か起きている」と読めるので、
        情報の色の小さな帯にする。
      */}
      <Notice data-design="Alert" tone="info" message="経路を確定できるのは「流入と計測」で発行したリンクから来た人だけです。素のQR・検索から来た人は「経路が分からなかった人」の設定が動きます。" className="mb-4" />

      {/*
        R31: まとめの数はすべて直近7日にそろえる。設定の数（初回案内）は
        いまの数なので、期間の数と混ざらないよう「？」で補足する。
      */}
      <section data-design="Flow" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="直近7日の状況">
        <span className="sr-only">どう振り分けられるか。友だち追加された。直近7日の実績。</span>
        <KpiCard title="初回案内" value={data?.summary.rules ?? 0} unit="件" detail={`有効 ${data?.summary.active ?? 0}件`} help="いまある初回案内の設定数です。右の3つ（直近7日）とは期間がちがいます。" variant="v6" />
        <KpiCard title="直近7日の友だち追加" value={data?.summary.recentAdds ?? null} unit="人" detail={`経路が取れた ${countText(data?.summary.captured ?? null, '人')}`} help="直近7日に友だち追加された人数と、そのうち流入リンクが分かった人数です。" variant="v6" />
        <KpiCard title="直近7日の送信成功" value={data?.summary.delivered ?? null} unit="通" detail={successRate(data?.summary.delivered ?? null, data?.summary.failed ?? null)} help="直近7日に実際に送った通数です。送信履歴の累計配信と同じ数え方です。" variant="v6" />
        <KpiCard title="直近7日の経路不明" value={data?.summary.unknownRoute ?? null} unit="人" detail="直近7日の人数です。共通の案内が動きます。" help="直近7日に追加され、流入リンクが分からなかった人数です。経路が分からなかった人へ共通の案内が動きます。" badge={(data?.summary.unknownRoute ?? 0) > 0 ? '要確認' : undefined} badgeTone="warning" variant="v6" />
      </section>

      {/* 作る操作は数字のカードの下・一覧のすぐ上の左。 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button href="/friend-add-settings?view=new" variant="primary">＋ 初回案内を作る</Button>
      </div>

      {/*
        #972: 390pxでは2つの切替タブが右へはみ出し、下の表の見出しも
        重なって読めなかった。共通部品の形は変えず、この画面だけ
        「収まらないときタブは折り返す・表は枠の内側で横へ動かす」にする。
        収まる幅では見た目は変わらない。
        #636: 表の最小幅は 860→720px。1440pxではフォルダ欄を引いた
        枠の実幅が834pxしかなく、860pxを指定すると26pxの横スクロールが
        常時出ていた。720pxなら1440pxに収まり、狭い幅では従来どおり
        枠の内側だけが横へ動く。
      */}
      <style>{`
        [data-tabs-row] nav:has(> span) { height: auto; flex-wrap: wrap; row-gap: 8px; }
        [data-tabs-row] nav:has(> span) > span { flex-wrap: wrap; row-gap: 0; }
        [data-scroll-table] > div { overflow-x: auto; }
        [data-scroll-table] table { min-width: 720px; }
      `}</style>
      <div data-design="FirstTime" data-tabs-row>
        <span className="sr-only">開始のタイミング。すぐに配信。あわせて実行すること。</span>
        <Tabs label="配信の種類" items={(Object.keys(KIND_LABELS) as FriendAddRuleKind[]).map((tab) => ({ label: KIND_LABELS[tab], current: kind === tab, onClick: () => { resetCursor(); router.replace(`/friend-add-settings?kind=${tab}`) } }))} />
        <span data-design="Returning" className="sr-only">以前からの友だち・ブロックを解除した人。配信しない。別のシナリオを配信する。はじめての人と同じものを配信する。開始位置。前回読んだところから。</span>
      </div>
      <p className="text-ink-faint text-xs">この2つを分けないと、以前からのお客さまに「はじめまして」が届きます。</p>

      {/*
        #636: lg未満の単列も明示トラックにする。暗黙列は中身の
        max-content（表の最小幅）へ広がり、390/768pxでページ全体が
        約880pxにはみ出していた。minmax(0,1fr)で枠幅に留める。
      */}
      <div style={FOLDER_RAIL_STYLE} className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]">
        <FolderPanel
          /* 見出しの総数は「すべて」の行と同じ数なので出さない（件数の重ね書きをやめる）。 */
          activeId={folder ?? ''}
          onSelect={(id) => selectFolder(id || null)}
          onAddFolder={() => setFolderDialogOpen(true)}
          addFolderDisabled={folderBusy}
          rows={[
            { id: '', label: 'すべて', count: data?.total ?? data?.items.length ?? 0 },
            ...folders.map((entry) => ({ id: entry.key, label: entry.name, count: entry.count })),
          ]}
        />

        {/*
          #636: grid の子は min-w-0 が無いと中身（表の最小幅）まで縮まず、
          lg未満の単列でページ全体が横へはみ出していた（390/768pxで
          ページsw≈880）。縮めて、逃がす先を表の枠内スクロールに閉じる。
        */}
        <section data-design="Rule" aria-label={`${KIND_LABELS[kind]}の設定`} className="min-w-0">
          <span className="sr-only">判定の基準。はじめての人の判定。ブロック解除の判定。ブロック解除の回数が1回以上。</span>
          {/* ★V7：件数は選べないので「20件表示」の文字だけを置かない。 */}
          <ListToolbar search={{ placeholder: '設定名で検索', value: search, onChange: setSearch }} />
          {!data || data.items.length === 0 ? (
            appliedSearch.trim() || folder ? (
              <ListState kind="empty" title="条件に合う設定はありません" description="検索やフォルダの絞り込みを変えてください。" />
            ) : (
              <ListState kind="empty" title="友だち追加時の配信がまだありません" description="最初の案内を作ると、ここに表示されます。" action={<Button href="/friend-add-settings?view=new" variant="primary">＋ 友だち追加時配信を作る</Button>} />
            )
          ) : (
            <>
              {/* #972 U039: 狭い幅では見出し同士が重なるため、枠の内側で横へ動かせるようにする。 */}
              <div data-scroll-table>
              <DataTable>
                {/* 見出しは固定幅の表で切れることがあるため、重ねると全文が
                    読める title を付ける（第5パス D-3）。 */}
                {/*
                  #636: 最小幅720pxでは均等6列だと各120pxしかなく、右端の
                  操作（編集＋削除＋…）が枠から切れる。状態・直近7日・操作へ
                  固定幅を当て、残りを文字列の3列へ回す。狭い列の文字は
                  従来どおり1行省略＋titleで全文を確認できる。
                */}
                <thead><TableHeadRow><Th title="設定名">設定名</Th><Th title="状態" className="w-24">状態</Th><Th title="対象の流入リンク">対象の流入リンク</Th><Th title="最初に送るもの">最初に送るもの</Th><Th title="直近7日の友だち追加数" className="w-24">直近7日</Th><Th title="操作" className="w-40">操作</Th></TableHeadRow></thead>
                <tbody>
                  {visibleItems.map((rule) => (
                    <Tr key={rule.id}>
                      <NameCell name={<a href={`/friend-add-settings?view=edit&id=${encodeURIComponent(rule.id)}`} className="text-ink block truncate font-bold" title={rule.name}>{rule.name}</a>} sub={rule.isFallback ? 'いちばん最後に動く・消せない' : `優先順位 ${rule.priority}`} />
                      <Td><StatusBadge tone={rule.status === 'published' || rule.isFallback ? 'success' : 'neutral'} size="compact">{rule.isFallback ? '常に有効' : rule.status === 'published' ? '有効' : rule.status === 'draft' ? '下書き' : rule.status === 'stopped' ? '停止中' : 'アーカイブ'}</StatusBadge></Td>
                      <Td><span className="block truncate" title={routeLabel(rule)}>{routeLabel(rule)}</span></Td>
                      <Td><span className="block truncate" title={deliverySummary(rule)}>{deliverySummary(rule)}</span></Td>
                      <Td>{countText(rule.matchedLast7Days, '人')}</Td>
                      <ActionCell>
                        {/*
                          ★V7 `Xn1Mz`：行の操作は「主な1つ（編集）＋…」。
                          削除はメニューの中の危ない操作へ。ゴミ箱のアイコン
                          だけのボタンは行に直に置かない。消せない行（共通の
                          あいさつ）は「…」を出さない。
                          その他操作は実画面へつなぐメニューを開く。行き先のない
                          ボタンを置くと、押しても何も起きない死に操作になる。
                        */}
                        <div className="flex items-center gap-1">
                          <RowActions
                            subjectName={rule.name}
                            edit={{ href: `/friend-add-settings?view=edit&id=${encodeURIComponent(rule.id)}` }}
                            menuItems={[
                              {
                                id: 'test',
                                label: 'テストを実行',
                                icon: <FlaskConical size={16} />,
                                onSelect: () => router.push(`/friend-add-settings?view=edit&id=${encodeURIComponent(rule.id)}&step=preview`),
                              },
                              ...(rule.status === 'draft' ? [{
                                id: 'publish',
                                label: '最終確認・有効化へ進む',
                                icon: <Rocket size={16} />,
                                onSelect: () => router.push(`/friend-add-settings/publish?id=${encodeURIComponent(rule.id)}`),
                              }] : []),
                              {
                                id: 'runs',
                                label: 'この設定の実行結果',
                                icon: <History size={16} />,
                                onSelect: () => router.push(`/friend-add-settings/runs?rule_id=${encodeURIComponent(rule.id)}`),
                              },
                            ]}
                            destructiveItem={rule.isFallback ? undefined : {
                              id: 'delete',
                              label: '削除する',
                              onSelect: () => setDeleting(rule),
                            }}
                          />
                        </div>
                      </ActionCell>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
              </div>
              {/*
                m22d: 件数は上の「初回案内」カードの1か所に集約し、一覧の
                下では繰り返さない。ページ送りだけ残す。
              */}
              {(canPrev || data.nextCursor) ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2" aria-label="ページ送り">
                    <Button disabled={!canPrev || loading} onClick={() => goPrev()}>前へ</Button>
                    <Button disabled={!data.nextCursor || loading} onClick={() => goNext(data.nextCursor)}>次へ</Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      <ConfirmDialog open={Boolean(deleting)} designNode="Q3qP1r" title={`「${deleting?.name ?? ''}」を削除しますか？`} description="削除すると、このリンクから追加された人には「経路が分からなかった人」の共通あいさつが動きます。過去の実行履歴は監査記録として残り、この操作は取り消せません。" confirmLabel="削除する" destructive busy={deleteBusy} error={deleteError} titleIcon={<Trash2 size={20} />} onCancel={closeDelete} onConfirm={() => void archiveRule()} />
      <ConfirmDialog
        open={folderDialogOpen}
        title="流入の束を追加"
        description="設定を整理するフォルダ名を入力してください。"
        confirmLabel="追加する"
        busy={folderBusy}
        onCancel={() => {
          setFolderDialogOpen(false)
          setFolderName('')
        }}
        onConfirm={folderName.trim() ? () => void createFolder() : undefined}
      >
        <label className="grid gap-2 text-sm font-medium">
          フォルダ名
          <input
            autoFocus
            className="rounded-control border-hairline bg-canvas border px-3 py-2 font-normal"
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            maxLength={50}
          />
        </label>
      </ConfirmDialog>
    </div>
  )
}
