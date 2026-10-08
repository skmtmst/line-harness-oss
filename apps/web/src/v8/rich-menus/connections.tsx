'use client'

/*
 * ★V8 リッチメニュー「切替のつながり」（Pencil `wxIQ7`）。
 *
 * 読み込み（古い応答を捨てる）・404 と失敗の分け方・アカウント違いの扱い・つながりの調べ方
 * （保存済みのページと切替ボタンだけから、戻れない・届かない・切替先なしを見る）は今の画面
 * （app/rich-menus/connections/page.tsx）と同じ。見せ方を絵に合わせた：
 * 左に段「つながりの図」（メニューのカードとタブの行き来）と「よくある事故の見張り」、
 * 右の列に操作（編集する・切替のつながり・…）と「いまの状態」。
 * 受け付ける URL：`/rich-menus/connections?id=<メニュー>`。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeftRight, ArrowRight, GitFork, Pencil, Plus, TriangleAlert } from 'lucide-react'
import { api, ApiError, type RichMenuAreaResponse } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import { formatNumber } from '@/lib/format'
import { analyzeConnections, type ConnectionAnalysis, type ConnectionPage } from './connection-analysis'
import styles from './connections.module.css'

const MAX_PAGES = 10

type RichMenuGroup = {
  id: string
  accountId: string
  name: string
  status: 'draft' | 'published'
  defaultPageId: string | null
  isDefaultForAll?: boolean
  targetingEnabled?: boolean
  targetingCondition?: string | null
  audienceCount?: number | null
  monthlyStats?: { taps: number; uniqueAudience?: { value: number | null } }
  pages: Array<ConnectionPage & { areas: RichMenuAreaResponse[] }>
}

/** 取得結果の形を確かめる（`as` 断定の代わり）。 */
function isRichMenuGroupResponse(value: unknown): value is RichMenuGroup {
  if (!value || typeof value !== 'object') return false
  return 'id' in value && typeof value.id === 'string' && 'pages' in value && Array.isArray(value.pages)
}

const tabLetter = (index: number) => String.fromCharCode(65 + index)

/** 入口のメニューと各ページの行き来（「タブB ⇄ タブA」）。行き来の札は入口から見たタブ・戻りのタブ。 */
export function linkLabel(analysis: ConnectionAnalysis, entryId: string, pageId: string): { label: string; both: boolean } {
  const out = analysis.edges.filter((edge) => edge.fromPageId === entryId)
  const back = analysis.edges.filter((edge) => edge.fromPageId === pageId)
  const goIndex = out.findIndex((edge) => edge.targetPageId === pageId)
  const backIndex = back.findIndex((edge) => edge.targetPageId === entryId)
  /*
   * WEB220：直接のタブが無くても、別のメニューを通って行ける・戻れることがある（A→B→C→A）。
   * 行けるか・戻れるかは、たどり着けるかの解析（reachable・cannotReturn）で決める。
   */
  const reachable = analysis.reachablePageIds.has(pageId)
  const returnable = reachable && !analysis.cannotReturnPageIds.has(pageId)
  if (goIndex < 0 && backIndex < 0) {
    if (reachable && returnable) return { label: '別のメニュー経由で行き来', both: true }
    if (reachable) return { label: '別のメニュー経由・戻りなし', both: false }
    return { label: 'つながりなし', both: false }
  }
  if (goIndex < 0) return { label: `タブ${tabLetter(backIndex)} → トップ`, both: false }
  if (backIndex < 0) return { label: returnable ? `タブ${tabLetter(goIndex + 1)} → 経由して戻れる` : `タブ${tabLetter(goIndex + 1)} → 戻りなし`, both: returnable }
  return { label: `タブ${tabLetter(goIndex + 1)} ⇄ タブ${tabLetter(backIndex)}`, both: true }
}

export default function RichMenuConnectionsV8() {
  return (
    <Suspense fallback={<ListState kind="loading" title="切替のつながりを読み込んでいます" />}>
      <Connections />
    </Suspense>
  )
}

function Connections() {
  const router = useRouter()
  const groupId = useSearchParams().get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const activeAccountIdRef = useRef(selectedAccountId)
  const requestGenerationRef = useRef(0)
  const [group, setGroup] = useState<RichMenuGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [missing, setMissing] = useState(false)

  usePageTitle('切替のつながり')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'リッチメニュー', href: '/rich-menus' }])
  activeAccountIdRef.current = selectedAccountId

  const load = useCallback(async () => {
    if (!groupId || !selectedAccountId) {
      setLoading(false)
      return
    }
    const accountId = selectedAccountId
    const generation = ++requestGenerationRef.current
    const stale = () => activeAccountIdRef.current !== accountId || requestGenerationRef.current !== generation
    setLoading(true)
    setGroup(null)
    setError('')
    setMissing(false)
    try {
      const response = await api.richMenuGroups.get(groupId)
      if (stale()) return
      if (!response.success) throw new Error(response.error)
      if (!isRichMenuGroupResponse(response.data)) throw new Error('取得失敗')
      setGroup(response.data)
    } catch (caught) {
      if (stale()) return
      setGroup(null)
      if (caught instanceof ApiError && caught.status === 404) {
        setMissing(true)
        return
      }
      setError('切替のつながりを表示できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [groupId, selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
  }, [accountLoading, load])

  const analysis = useMemo(() => group ? analyzeConnections(group.pages, group.defaultPageId) : null, [group])

  if (accountLoading || loading) return <ListState kind="loading" title="切替のつながりを読み込んでいます" />
  if (!selectedAccountId) return <ListState kind="empty" title="LINE公式アカウントを選んでください" description="表示するアカウントを上の切替から選んでください。" />
  if (!groupId) {
    return <TargetMissing kind="unspecified" title="つながりを見るメニューが指定されていません" description="メニューの一覧から、つながりを見るメニューを選び直してください。" backHref="/rich-menus" backLabel="メニュー一覧へ戻る" />
  }
  if (missing || (!error && (!group || !analysis))) {
    return <TargetMissing kind="not-found" title="このメニューは見つかりません" description="削除されたか、別の記録です。一覧から選び直してください。" backHref="/rich-menus" backLabel="メニュー一覧へ戻る" />
  }
  if (error || !group || !analysis) {
    return <TargetMissing kind="error" title="切替のつながりを表示できませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => void load()} />
  }
  if (group.accountId !== selectedAccountId) {
    return <ListState kind="forbidden" title="選択中のアカウントでは表示できません" description="このメニューが所属するLINE公式アカウントへ切り替えてください。" />
  }

  const pages = [...group.pages].sort((a, b) => a.orderIndex - b.orderIndex)
  const entryId = analysis.entryPageId ?? pages[0]?.id ?? ''
  const entry = pages.find((page) => page.id === entryId) ?? null
  const others = pages.filter((page) => page.id !== entryId)
  const editHref = `/rich-menus/edit?id=${encodeURIComponent(group.id)}`
  const buttonsHref = `/rich-menus/edit?id=${encodeURIComponent(group.id)}&step=buttons`
  // WEB220：直接のタブが無くても、別のメニューを通ってトップへ戻れるなら「帰れない」と言わない。
  const noReturn = others.filter((page) => analysis.cannotReturnPageIds.has(page.id))
  const draftTargets = group.status === 'published' ? others.filter((page) => !page.lineRichmenuId) : []
  const audienceText = group.isDefaultForAll || !group.targetingEnabled || !group.targetingCondition ? 'すべての友だち（既定）' : '条件で出し分け'
  const reach = group.monthlyStats?.uniqueAudience?.value ?? group.audienceCount ?? null
  const taps = group.monthlyStats?.taps ?? null

  const menuItems: ActionMenuItem[] = [
    { id: 'open', label: 'メニューを開く', external: true, onSelect: () => router.push(editHref) },
    { id: 'list', label: 'メニュー一覧へ', onSelect: () => router.push('/rich-menus') },
  ]

  const aside = (
    <div className={styles.aside}>
      <div className={styles.asideActions}>
        <Button href={editHref} className={styles.asideButton}><Pencil size={15} aria-hidden="true" />編集する</Button>
        <Button href={`/rich-menus/connections?id=${encodeURIComponent(group.id)}`} aria-current="page" className={styles.asideButton}><GitFork size={15} aria-hidden="true" />切替のつながり</Button>
        <span className={styles.menuAnchor}>
          <RowMenu className={styles.moreButton} label="そのほかの操作" items={menuItems} />
        </span>
      </div>
      <section className={styles.box} aria-labelledby="rm-state">
        <h2 className={styles.boxTitle} id="rm-state">いまの状態</h2>
        <div className={styles.row}><span>状態</span><strong>{group.status === 'published' ? '公開中' : '下書き'}</strong></div>
        <div className={styles.row}><span>出す相手</span><strong>{audienceText}</strong></div>
        <div className={styles.row}><span>出る人</span><strong>{reach === null ? '—' : `${formatNumber(reach)}人`}</strong></div>
        <div className={styles.row}><span>今月押された</span><strong>{taps === null ? '—' : `${formatNumber(taps)}回`}</strong></div>
      </section>
    </div>
  )

  return (
    <CreatePage
      boardId="wxIQ7"
      title={`切替のつながり：${group.name}`}
      description="タブで行き来できるメニューの関係"
      identity={<Link href="/rich-menus" className={styles.backLink}>← リッチメニューへ</Link>}
      preview={aside}
      footerActions={<>
        <Button href="/rich-menus">メニュー一覧へ</Button>
        <Button variant="primary" href={buttonsHref}>ボタンの動きを直す</Button>
      </>}
    >
      <section className={styles.card} aria-labelledby="rm-map">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="rm-map">つながりの図</h2>
          <p className={styles.cardNote}>{others.length > 0 ? '緑のタブが「別のメニューへ移る」ボタンです' : '切替先を足すと、ここに「どのメニューからどこへ移れるか」が出ます'}</p>
        </div>
        <div className={styles.map}>
          {entry ? (
            <article className={styles.menu} data-entry="">
              <span className={styles.menuImage} aria-hidden="true" />
              <strong className={styles.menuName} title={entry.name}>{entry.name}</strong>
              <span className={styles.menuSub}>このメニュー・タブA</span>
            </article>
          ) : null}
          {others.map((page, index) => {
            const link = linkLabel(analysis, entryId, page.id)
            const returns = !noReturn.some((item) => item.id === page.id)
            return (
              <div key={page.id} className={styles.mapPair}>
                <span className={styles.link}>
                  <span>{link.label}</span>
                  {link.both ? <ArrowLeftRight className={styles.linkIcon} aria-hidden="true" /> : <ArrowRight className={styles.linkIcon} aria-hidden="true" />}
                </span>
                <article className={styles.menu} data-broken={returns ? undefined : ''}>
                  <span className={styles.menuImage} aria-hidden="true" />
                  <strong className={styles.menuName} title={page.name}>{page.name}</strong>
                  <span className={styles.menuSub}>{`タブ${tabLetter(index + 1)}・${returns ? '戻るタブあり' : '戻るタブなし'}`}</span>
                </article>
              </div>
            )
          })}
        </div>
        <div className={styles.addRow}>
          {pages.length < MAX_PAGES ? (
            <Button variant="text" href={buttonsHref}><Plus size={15} aria-hidden="true" />{`切替先のメニューを足す（最大${MAX_PAGES}枚）`}</Button>
          ) : <span className={styles.cardNote}>{`切替先は最大${MAX_PAGES}枚です`}</span>}
          <span className={styles.count}>{`${pages.length}枚`}</span>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="rm-watch">
        <div className={styles.cardHead}><h2 className={styles.cardTitle} id="rm-watch">よくある事故の見張り</h2></div>
        {noReturn.map((page) => (
          <div key={page.id} className={styles.warn}>
            <TriangleAlert className={styles.icon} aria-hidden="true" />
            <span className={styles.warnText}>{`「${page.name}」に${entry ? `${entry.name}へ` : ''}戻るタブがありません。押した人が元のメニューに帰れません。`}</span>
            <Button href={buttonsHref}>{`${page.name}を開いて直す`}</Button>
          </div>
        ))}
        {analysis.missingTargetEdges.length > 0 ? (
          <div className={styles.check}><span>切替先が見つからないタブ</span><strong className={styles.bad}>{`${analysis.missingTargetEdges.length}件`}</strong></div>
        ) : null}
        {analysis.unreachablePageIds.size > 0 ? (
          <div className={styles.check}><span>どこからも来られないメニュー</span><strong className={styles.bad}>{`${analysis.unreachablePageIds.size}件`}</strong></div>
        ) : null}
        <div className={styles.check}><span>切替先が下書きのまま</span><strong className={draftTargets.length ? styles.bad : undefined}>{draftTargets.length ? `${draftTargets.length}件` : 'なし'}</strong></div>
        {/* 「誰に出すか」はメニューの束ごとに決めるので、切替先だけ違うことは起きない。 */}
        <div className={styles.check}><span>切替先だけ「誰に出すか」が違う</span><strong>なし</strong></div>
      </section>
    </CreatePage>
  )
}
