'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, MoreHorizontal, Palette, Pencil, Trash2 } from 'lucide-react'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, ApiError, type TagDeleteImpact, type TagDeleteImpactReferences } from '@/lib/api'
import ActionMenu from '@/components/shared/action-menu'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import Notice from '@/components/shared/notice'
import Button from '@/components/shared/button'
import ListKpis from '@/components/shared/list-kpis'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { Tabs } from '@/components/shared/tabs'
import FriendFieldList from './field-list'
import SupportMarkList from './mark-list'
import SavedSearchList from './saved-search-list'
import TagCsvImportDialog from './tag-csv-import-dialog'

const TABS = [
  ['tags', 'タグ'],
  ['fields', '友だち情報欄'],
  ['marks', '対応マーク'],
  ['searches', '保存した検索'],
] as const
type TabKey = (typeof TABS)[number][0]
const UNGROUPED = '__ungrouped__'

/**
 * 一覧に中身を出せるかどうか。
 *
 * **`items.length === 0` だけを見て「ありません」と出さない**ための状態。
 * 読み込みに失敗しても同じ文が出ていて、運用する人からは「登録したものが
 * 消えた」ように見えていた（PR #216 と同じ壊れ方）。403 も分ける。
 * 「見せてよい人ではない」を「表示できませんでした」と出すと、
 * 直らない再読み込みを繰り返させることになる。
 */
type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/* ---- 4-1 の表のための小物。設計 `HrwyW` の値をそのまま持つ ---- */

/** 並び替えのつまみ。設計 `DaXeY`（lucide grip-vertical・16px・hairline）。 */
function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="inline-block">
      <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}

/** 一覧表示の★。設計 `zMlMX`（lucide star・16px）。 */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z" />
    </svg>
  )
}

/** 削除。設計 `E2NC4`（lucide trash-2・18px・$status-danger）。 */
function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" /><path d="M14 11v6" />
    </svg>
  )
}

/**
 * フォルダの選び直し。設計 `SgpDb` は「色の丸 ＋ 名前 ＋ ▾」の小さな札で、
 * 素の `select` ではない。見た目は札が持ち、操作と読み上げは `select` が持つ。
 */
function FolderSelect({ tag, groups, onChanged }: { tag: Tag; groups: TagGroup[]; onChanged: () => void }) {
  const group = groups.find((item) => item.id === tag.groupId)
  return (
    <span className="relative inline-flex h-7 items-center gap-1.5 rounded-mini border border-hairline bg-canvas px-2">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group?.color ?? '#c3c8c4' }} />
      <span className="truncate text-caption font-semibold text-ink">{group?.name ?? '未分類'}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-ink-faint"><path d="m6 9 6 6 6-6" /></svg>
      <select
        aria-label={`${tag.name} のフォルダ`}
        value={tag.groupId ?? ''}
        onChange={async (event) => { await api.tags.setGroup(tag.id, event.target.value || null); onChanged() }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        <option value="">未分類</option>
        {groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </span>
  )
}

/**
 * 連動の札。設計 `B9QCB3`（緑）／`IoiWQ`（黄）／`Ws7fo`（灰）。
 *
 * 灰色の「他N」は、マイル以外の連動アクション（テキスト送信・
 * テンプレート送信・シナリオ開始など）の数。0件のときサーバーは
 * `otherActionCount` を省くので、**「他0」は出さない**。
 */
function linkChips(tag: Tag): Array<{ label: string; tone: string }> {
  const chips: Array<{ label: string; tone: string }> = []
  if (tag.mileageReward) chips.push({ label: `本人+${tag.mileageReward}`, tone: 'bg-accent-soft text-accent' })
  if (tag.referralMileageReward) chips.push({ label: `紹介+${tag.referralMileageReward}`, tone: 'bg-accent-soft text-accent' })
  if (tag.mileageMultiplierBps) chips.push({ label: `${tag.mileageMultiplierBps / 10000}倍`, tone: 'bg-status-warn-soft text-status-warn-deep' })
  if (tag.otherActionCount) chips.push({ label: `他${tag.otherActionCount}`, tone: 'bg-canvas-sunken text-ink-faint' })
  return chips
}

/** 設計 `tuisA` ほかの6種。サーバーの `assignSource` と1対1。 */
const SOURCE_LABELS: Record<NonNullable<Tag['assignSource']>, string> = {
  ec: 'EC連携',
  line_login: 'LINE Login',
  form: '回答フォーム',
  ec_purchase: 'EC購入',
  manual: '手動',
  birthday: '誕生日ルール',
}

/**
 * 自動付与のもと。
 *
 * **無いときは `—`。「手動」と書かない。** サーバーは「いまのデータから
 * 出どころを断定できるものだけ」を返す（`friend_tags` に付与元が
 * 残っていないため、一般のタグを manual と推測しない）。
 * ここで「手動」と埋めると、断定できなかったものを断定したことになる。
 */
function sourceLabel(tag: Tag): string {
  return tag.assignSource ? SOURCE_LABELS[tag.assignSource] : '—'
}

/** 設計 `lML5Q`「配信3・フォーム1」の呼び分けと並び順。 */
const USAGE_LABELS: Array<[keyof NonNullable<Tag['usedIn']>, string]> = [
  ['broadcasts', '配信'],
  ['forms', 'フォーム'],
  ['scenarios', 'シナリオ'],
  ['autoReplies', '自動応答'],
  ['savedSearches', '保存検索'],
]

/**
 * 使用先。設計は「配信3・フォーム1」のように数まで出す。
 *
 * **`withCounts=1` で読んでいるので、`usedIn` が無いのは「0件」。**
 * 集計していないわけではないので、`—` ではなく言い切ってよい。
 * （`withCounts` を付けずに読む画面でこの関数を使うときは、この前提が崩れる）
 *
 * **「なし」であって「未使用」ではない。** 2026-08-26 に「未使用」の定義が
 * 「友だち0人**かつ**全参照0件」で確定した。この列が見ているのは参照だけなので、
 * 友だち200人・参照0件のタグをここで「未使用」と書くと、絞り込みやKPIの
 * 「未使用」と別の意味になる。同じ画面で1つの言葉に2つの意味を持たせない。
 */
function usageLabel(tag: Tag): string {
  if (!tag.usedIn) return 'なし'
  const parts = USAGE_LABELS
    .map(([key, label]) => (tag.usedIn?.[key] ? `${label}${tag.usedIn[key]}` : null))
    .filter(Boolean)
  return parts.length ? parts.join('・') : 'なし'
}

/**
 * 整理候補の理由。サーバーがタグごとに返す。
 *
 * `unused` … 友だち0人**かつ**全18種の参照0件
 * `duplicate_name` … 正規化した名前が他のタグと重なる
 *   （NFKC → 前後空白除去 → 連続空白を1つ → 小文字化）
 *
 */
/**
 * 整理候補の数え方が**サーバーから来ているか**。
 *
 * **1つでも欠けていたら「来ていない」とみなす。** 揃っていないまま数えると、
 * 欠けたぶんだけ少ない数を出すことになる。少なめに出た「未使用」は、
 * 「整理するものは無い」と読まれて放置される。
 *
 * `cleanupReasons` は `withCounts=1` のとき**理由が無くても `[]` で必ず返す**
 * 約束（`docs/v6-4-1-handoff.md` §0-1）。省略＝未取得。
 */
function cleanupKnown(items: Tag[], ready: boolean): boolean {
  // 読み込み中の空配列と、取得済みの0件を区別する。後者は `0件` と出せる。
  return ready && items.every((tag) => Array.isArray(tag.cleanupReasons))
}

/**
 * 未使用。**友だち0人かつ全18種の参照0件**（kenta 確定 2026-08-26）。
 *
 * 参照だけを見ていた頃は、200人に付いているタグまで「未使用」に入り、
 * 整理候補として消させるところだった。
 *
 * サーバーが `cleanupReasons` を返しているならそれに従う。**画面とサーバーで
 * 別々に数えない**（別々に数えると、同じ画面のKPIと絞り込みで数が食い違う）。
 */
function isUnused(tag: Tag): boolean {
  if (Array.isArray(tag.cleanupReasons)) return tag.cleanupReasons.includes('unused')
  return !tag.usedIn && (tag.friendCount ?? 0) === 0
}

/** 連動が1つでもあるか。「連動あり」の絞り込みと削除の確認で使う。 */
function hasLinkedActions(tag: Tag): boolean {
  return Boolean(tag.mileageReward || tag.referralMileageReward || tag.mileageMultiplierBps || tag.otherActionCount)
}

/**
 * 今月（日本時間）に作られたか。「今月増えたタグ」の判定。
 *
 * サーバーは UTC の ISO で返す。日本時間で数えないと、月初と月末の
 * 9時間ぶんがずれる（8/1 の朝に作ったタグが7月扱いになる）。
 */
function isThisMonth(value: string): boolean {
  const month = (d: Date) =>
    new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(d)
  return month(new Date(value)) === month(new Date())
}

/** 登録日。設計は `2026/01/11`（0埋め）。 */
function formatDate(value: string): string {
  const d = new Date(value)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`
}

/**
 * 設計 `UOmne` の「よく使う」。**5つとも効く。**
 *
 * 2026-08-26 まで3つしか無く、しかも「今月増えた」は絞り込みの中に
 * 対応する枝が無くて**押しても何も起きなかった**。
 */
const QUICK_FILTERS: Array<[string, string]> = [
  ['unused', '未使用のタグ'],
  ['recent', '今月増えたタグ'],
  ['auto', '自動付与あり'],
  ['linked', '連動あり'],
  ['starred', '★のみ表示'],
]

const cardShadow = '[box-shadow:1px_1px_1px_rgba(15,23,42,0.14)]'

export const FRIEND_ATTRIBUTES_QA_GROUPS: TagGroup[] = [
  { id: 'qa-vip', name: 'VIP', sortOrder: 0, color: '#F59E0B', createdAt: '', updatedAt: '' },
  { id: 'qa-pet', name: 'ペット', sortOrder: 1, color: '#EC4899', createdAt: '', updatedAt: '' },
  { id: 'qa-member', name: '会員', sortOrder: 2, color: '#10B981', createdAt: '', updatedAt: '' },
  { id: 'qa-purchase', name: '購入', sortOrder: 3, color: '#3B82F6', createdAt: '', updatedAt: '' },
]

export const FRIEND_ATTRIBUTES_QA_TAGS: Tag[] = [
  ['EC顧客連携済み', 'qa-purchase', 5, 10, 0, 12000],
  ['LINEログイン連携済み', 'qa-member', 5, 0, 0, null],
  ['NEN会員', 'qa-member', 5, 10, 5, 15000],
  ['商品到着確認対象', 'qa-purchase', 3, 1, 0, null],
  ['未契約', '', 3, 0, 0, null],
  ['誕生日クーポン対象', 'qa-vip', 0, 20, 0, null],
].map(([name, groupId, friendCount, mileageReward, referralMileageReward, mileageMultiplierBps], index) => ({
  id: `qa-${index}`,
  name: String(name),
  color: '#8b938d',
  groupId: String(groupId),
  friendCount: Number(friendCount),
  mileageReward: Number(mileageReward),
  referralMileageReward: Number(referralMileageReward),
  mileageMultiplierBps: mileageMultiplierBps == null ? null : Number(mileageMultiplierBps),
  mileageMultiplierPriority: 0,
  isStarred: index < 2,
  displayOrder: index,
  createdAt: '2026-01-13T00:00:00.000Z',
}))

function FolderList({ groups, items, countsKnown, active, onSelect, onChanged }: { groups: TagGroup[]; items: Tag[]; countsKnown: boolean; active: string; onSelect: (id: string) => void; onChanged: () => void }) {
  const [menuId, setMenuId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [menuError, setMenuError] = useState('')
  const [deleteGroup, setDeleteGroup] = useState<TagGroup | null>(null)
  const rows = [
    { id: '', name: 'すべて', count: items.length, color: '#06c755' },
    ...groups.map((group) => ({ id: group.id, name: group.name, count: items.filter((tag) => tag.groupId === group.id).length, color: group.color ?? '#8b938d' })),
    { id: UNGROUPED, name: '未分類', count: items.filter((tag) => !tag.groupId).length, color: '#c3c8c4' },
  ]
  const move = async (group: TagGroup, direction: -1 | 1) => {
    const index = groups.findIndex((item) => item.id === group.id)
    const other = groups[index + direction]
    if (!other || busy) return
    setBusy(true); setMenuError('')
    try {
      const [currentResult, otherResult] = await Promise.all([
        api.tagGroups.update(group.id, { sortOrder: index + direction }),
        api.tagGroups.update(other.id, { sortOrder: index }),
      ])
      if (!currentResult.success) throw new Error(currentResult.error)
      if (!otherResult.success) throw new Error(otherResult.error)
      onChanged()
    } catch (reason) {
      setMenuError(reason instanceof Error ? reason.message : '並び順を変更できませんでした')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (group: TagGroup) => {
    if (busy) return
    setBusy(true); setMenuError('')
    try {
      const result = await api.tagGroups.delete(group.id)
      if (!result.success) throw new Error(result.error)
      if (active === group.id) onSelect('')
      setDeleteGroup(null)
      onChanged()
    } catch (reason) {
      setMenuError(reason instanceof Error ? reason.message : 'フォルダを削除できませんでした')
    } finally {
      setBusy(false)
    }
  }
  return (
    <aside className={`h-fit rounded-card border border-hairline bg-canvas ${cardShadow}`}>
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3"><h2 className="text-sm font-bold text-ink">フォルダ</h2><span className="text-xs text-ink-faint">{countsKnown ? `${items.length}件` : '—'}</span></div>
      <nav className="p-2">{rows.map((row) => {
        const group = groups.find((item) => item.id === row.id)
        const groupIndex = group ? groups.findIndex((item) => item.id === group.id) : -1
        return <div key={row.id} className="group relative flex items-center"><button type="button" onClick={() => onSelect(row.id)} className={`flex min-w-0 flex-1 items-center gap-2 rounded-control px-3 py-2.5 text-left text-label ${active === row.id ? 'bg-accent-soft font-bold text-accent' : 'font-semibold text-ink hover:bg-canvas-sunken'}`}><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} /><span className="min-w-0 flex-1 truncate">{row.name}</span><span className={`inline-flex h-[26px] shrink-0 items-center rounded-pill px-[9px] text-caption font-semibold tabular-nums ${active === row.id ? 'bg-canvas text-accent' : 'bg-canvas-sunken text-ink-faint'}`}>{countsKnown ? row.count : '—'}</span></button>{group ? <button type="button" aria-label={`${group.name}の操作`} aria-expanded={menuId === group.id} onClick={() => setMenuId((current) => current === group.id ? null : group.id)} className={`ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-ink-faint hover:bg-canvas-sunken focus-visible:outline ${active === row.id ? '' : 'invisible group-hover:visible'}`}><MoreHorizontal aria-hidden="true" size={16} /></button> : null}{group ? <ActionMenu open={menuId === group.id} onClose={() => setMenuId(null)} ariaLabel={`${group.name}の操作`} note="削除しても、中のタグは未分類に残ります。" items={[
          { id: 'rename', label: '名前を変更', icon: <Pencil size={15} />, onSelect: () => window.location.assign(`/tags/folders/new?id=${group.id}`) },
          { id: 'color', label: '色を変える', icon: <Palette size={15} />, onSelect: () => window.location.assign(`/tags/folders/new?id=${group.id}`) },
          { id: 'up', label: '並び順を上へ', icon: <ArrowUp size={15} />, disabled: busy || groupIndex === 0, onSelect: () => void move(group, -1) },
          { id: 'down', label: '並び順を下へ', icon: <ArrowDown size={15} />, disabled: busy || groupIndex === groups.length - 1, onSelect: () => void move(group, 1) },
          { id: 'delete', label: 'フォルダを削除', icon: <Trash2 size={15} />, tone: 'danger', dividerBefore: true, disabled: busy, onSelect: () => setDeleteGroup(group) },
        ]} /> : null}</div>
      })}</nav>
      {menuError ? <Notice className="mx-2 mb-2" tone="error" message={menuError} onClose={() => setMenuError('')} /> : null}
      <p className="border-t border-hairline px-4 py-3 text-[11px] leading-5 text-ink-faint">フォルダを削除しても、中のタグは未分類として残ります。</p>
      <ConfirmDialog
        open={Boolean(deleteGroup)}
        title={deleteGroup ? `「${deleteGroup.name}」を削除しますか？` : 'フォルダを削除しますか？'}
        description="削除しても、中のタグは未分類に残ります。この操作は元に戻せません。"
        confirmLabel="フォルダを削除"
        destructive
        busy={busy}
        onCancel={() => setDeleteGroup(null)}
        onConfirm={() => { if (deleteGroup) void remove(deleteGroup) }}
      />
    </aside>
  )
}

/**
 * 参照先の呼び分けと並び。設計 `dKlkz` は2行に分けている。
 *
 * - **参照先** … 人が選んで使っているもの。消すと「絞り込み条件から外れます」
 * - **参照先（自動）** … ひとりでに動くもの。消すと「開始条件が空になります」
 *
 * 設計が名指ししている5つ（一斉配信・回答フォーム／シナリオ・自動応答・
 * 保存検索）はそのままの組に置き、残り13はこの分け方に沿えた。
 * `GET /api/tags/:id/delete-impact` の18項目と1対1で、**取りこぼしを出さない**。
 */
const MANUAL_REFS: Array<[keyof TagDeleteImpactReferences, string]> = [
  ['broadcasts', '一斉配信'],
  ['forms', '回答フォーム'],
  ['templates', 'テンプレート'],
  ['richMenus', 'リッチメニュー'],
  ['webinars', 'ウェビナー'],
  ['events', 'イベント予約'],
  ['bookingMenus', '予約メニュー'],
  ['entryRoutes', '流入経路'],
  ['trackedLinks', '計測リンク'],
  ['affiliateOffers', 'アフィリエイト案件'],
  ['analyticsFunnels', 'ファネル'],
]

const AUTO_REFS: Array<[keyof TagDeleteImpactReferences, string]> = [
  ['scenarios', 'シナリオ'],
  ['autoReplies', '自動応答'],
  ['savedSearches', '保存検索'],
  ['automations', 'オートメーション'],
  ['commonActions', '共通アクション'],
  ['reminders', 'リマインダ'],
  ['friendAddSettings', '友だち追加時の配信'],
]

/** 「一斉配信3・回答フォーム1」。**0件のものは出さない。** */
function refSummary(
  refs: TagDeleteImpactReferences,
  labels: Array<[keyof TagDeleteImpactReferences, string]>,
): string {
  const parts = labels.filter(([key]) => refs[key] > 0).map(([key, label]) => `${label}${refs[key]}`)
  return parts.length ? parts.join('・') : 'なし'
}

/**
 * 設計 `★ V6 4-1-F タグ削除の確認ダイアログ`（`dKlkz`）の影響5行。
 *
 * 「名前・値・結果」の3列。**取れていないときは `—`。0とは書かない。**
 * 何が起きるか（結果）は設定によらず決まっているので、値が取れなくても出す。
 */
function deleteImpactRows(
  tag: Tag,
  impact: TagDeleteImpact | null,
): Array<{ name: string; value: string; result: string }> {
  const refs = impact?.references
  const linked = [
    tag.mileageReward ? `本人+${tag.mileageReward}` : null,
    tag.referralMileageReward ? `紹介者+${tag.referralMileageReward}` : null,
    tag.mileageMultiplierBps ? `${tag.mileageMultiplierBps / 10000}倍` : null,
    tag.otherActionCount ? `アクション${tag.otherActionCount}件` : null,
  ].filter(Boolean).join('／')

  return [
    {
      name: '付与人数',
      // 人数はサーバーが数え直したものを使う。取れなければ一覧の値。
      value: `${(impact?.friendCount ?? tag.friendCount ?? 0).toLocaleString('ja-JP')}人`,
      result: 'タグが外れます',
    },
    { name: '参照先', value: refs ? refSummary(refs, MANUAL_REFS) : '—', result: '絞り込み条件から外れます' },
    { name: '参照先（自動）', value: refs ? refSummary(refs, AUTO_REFS) : '—', result: '開始条件が空になります' },
    { name: '連動の停止', value: linked || 'なし', result: '以後は実行されません' },
    /*
      **数は出さない。口も待たない。**（kenta 判断 2026-08-26）

      設計の絵は「1,450 mile」だが、運用者がここで知りたいのは
      「消したら取り上げられるのか」であって、何マイルかではない。
      数が無くても判断はできる。`—` のままにすると「まだ数えている」
      ように見え、いつまでも埋まらない欄になる。
    */
    { name: '積んだマイル', value: 'そのまま残る', result: '取り消されません' },
  ]
}

function DeleteTagDialog({ tag, onCancel, onDeleted }: { tag: Tag; onCancel: () => void; onDeleted: () => void }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /**
   * 削除して何が失われるか（`GET /api/tags/:id/delete-impact`）。
   *
   * **DELETE 側にはまだ強制停止が入っていない。** 止めるのはここ。
   * 読み込み中と失敗のあいだも押せなくする。失敗を「参照0件」と読み違えて
   * 使用中のタグを消させないため。
   */
  const [impact, setImpact] = useState<TagDeleteImpact | null>(null)
  const [impactStatus, setImpactStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    setImpactStatus('loading')
    ;(async () => {
      try {
        const res = await api.tags.deleteImpact(tag.id)
        if (cancelled) return
        if (!res.success) throw new Error(res.error)
        setImpact(res.data)
        setImpactStatus('ready')
      } catch {
        if (!cancelled) setImpactStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [tag.id])

  /*
    共通の作法に寄せる。Escapeで閉じ、Tabが外へ出ず、**背景がスクロールしない**。
    自前で組むと毎回どれかが抜ける。実際、背景が裏で動いていた。
  */
  const dialogRef = useOverlayFocus(true, onCancel, saving)

  const blocked = impactStatus !== 'ready' || impact?.canDelete === false
  const blockedReason = impactStatus === 'loading'
    ? '影響を確認しています'
    : impactStatus === 'error'
      ? '影響を確認できませんでした。時間をおいて開き直してください'
      : impact && !impact.canDelete
        ? `使用中のため削除できません（${impact.blockingReferenceCount}件から参照されています）`
        : ''

  const remove = async () => {
    if (blocked || text !== tag.name || saving) return
    setSaving(true)
    try {
      const result = await api.tags.delete(tag.id)
      if (!result.success) throw new Error(result.error)
      onDeleted()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '削除に失敗しました')
      setSaving(false)
    }
  }

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 p-4" data-qa-dialog="tag-delete" data-impact={impactStatus}>
      <section className="w-full max-w-[680px] rounded-card border border-hairline bg-canvas p-7 shadow-2xl" role="alertdialog" aria-modal="true">
        <div className="flex items-start gap-3">
          {/* 設計 `iTwNX`/`lUbvQ`。赤いゴミ箱を22pxで見出しの左に置く。 */}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-danger-bg text-danger">
            <TrashIcon />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-ink">「{tag.name}」を削除しますか？</h2>
            <p className="mt-1 text-sm text-ink-secondary">このタグを使っている場所と、外れる友だちを確認してください。</p>
          </div>
        </div>

        {/* 設計 `X3Lkr`。名前・値・結果の3列。 */}
        <dl className="mt-5 divide-y divide-hairline overflow-hidden rounded-control border border-hairline text-sm">
          {deleteImpactRows(tag, impact).map((row) => (
            <div key={row.name} className="flex items-baseline gap-3 px-4 py-3">
              <dt className="w-[130px] shrink-0 text-ink-secondary">{row.name}</dt>
              <dd className="min-w-0 flex-1 font-bold text-ink">{row.value}</dd>
              <span className="shrink-0 text-xs text-ink-faint">{row.result}</span>
            </div>
          ))}
        </dl>

        {/* 設計 `WrDxu`。使用中で止まっているときだけ、その理由をここに出す。 */}
        {impactStatus === 'ready' && impact && !impact.canDelete && (
          <div data-qa="tag-delete-blocked-warning" className="mt-4 rounded-control border border-danger/25 bg-danger-bg p-3 text-sm text-danger">
            <p className="font-bold">使用中のため、このタグは削除できません</p>
            <p className="mt-1 text-ink-secondary">先に参照している側の設定からこのタグを外してください。削除しても、過去のマイル履歴と配信ログは残ります。</p>
          </div>
        )}

        {/* 設計 `seGRS`。 */}
        <label className="mt-5 block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-secondary">確認のため、タグ名を入力してください</span>
          <input value={text} onChange={(event) => setText(event.target.value)} placeholder={tag.name} disabled={blocked} className="w-full rounded-control border border-hairline px-3 py-2.5 text-sm outline-none focus:border-danger disabled:bg-canvas-sunken" />
        </label>
        {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}

        {/* 設計 `rHKRG`。左が「やめる」、右が「このタグを削除する」。 */}
        <div className="mt-6 flex items-center justify-end gap-3">
          {blockedReason && <p className="min-w-0 flex-1 text-xs text-ink-faint">{blockedReason}</p>}
          <button type="button" onClick={onCancel} className="shrink-0 rounded-control border border-hairline px-4 py-2.5 text-sm font-medium text-ink-secondary">やめる</button>
          <button type="button" disabled={blocked || saving || text !== tag.name} onClick={() => void remove()} className="shrink-0 rounded-control bg-danger px-4 py-2.5 text-sm font-bold text-on-accent disabled:opacity-40">{saving ? '削除中…' : 'このタグを削除する'}</button>
        </div>
      </section>
    </div>
  )
}

export default function TagsPageV4({
  fixture,
  accountId = null,
}: {
  fixture?: { items: Tag[]; groups: TagGroup[] }
  accountId?: string | null
}) {
  const router = useRouter()
  const params = useSearchParams()
  const rawTab = params.get('tab')
  const routeTab: TabKey = TABS.some(([key]) => key === rawTab) ? rawTab as TabKey : 'tags'
  const [fixtureTab, setFixtureTab] = useState<TabKey>('tags')
  const tab = fixture ? fixtureTab : routeTab
  const [items, setItems] = useState<Tag[]>(fixture?.items ?? [])
  const [groups, setGroups] = useState<TagGroup[]>(fixture?.groups ?? [])
  const [status, setStatus] = useState<LoadStatus>(fixture ? 'ready' : 'loading')
  // 操作の失敗（並び替え・★・フォルダ）。**読み込みの失敗とは別物**なので混ぜない。
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState('')
  const [usageFilter, setUsageFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  /**
   * 設計 `UOmne` の「よく使う」5つ。**複数えらべる。**
   * 1つずつしか選べないと、「未使用」かつ「今月増えた」が出せない。
   */
  const [quick, setQuick] = useState<string[]>([])
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [dragId, setDragId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)
  const [csvOpen, setCsvOpen] = useState(false)

  const load = useCallback(async () => {
    if (fixture) return
    setStatus('loading')
    setError('')
    try {
      const [tags, folders] = await Promise.all([api.tags.list({ withCounts: true }), api.tagGroups.list()])
      // `success: false` を黙って捨てない。捨てると空の表を「0件」として見せる。
      if (!tags.success) throw new Error(tags.error)
      setItems(tags.data)
      if (folders.success) setGroups(folders.data)
      setStatus('ready')
    } catch (reason) {
      setStatus(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
    }
  }, [fixture])
  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => items.filter((tag) => {
    if (query && !tag.name.toLowerCase().includes(query.toLowerCase())) return false
    if (folder === UNGROUPED && tag.groupId) return false
    if (folder && folder !== UNGROUPED && tag.groupId !== folder) return false
    const linked = hasLinkedActions(tag)
    // 「未使用」は**友だち0人かつ全参照0件**（`isUnused`）。
    // 参照だけで判断すると、200人に付いているタグまで整理候補に入る。
    const unused = isUnused(tag)
    if (usageFilter === 'linked' && !linked) return false
    if (usageFilter === 'unused' && !unused) return false
    if (sourceFilter !== 'all' && tag.assignSource !== sourceFilter) return false
    for (const key of quick) {
      if (key === 'unused' && !unused) return false
      if (key === 'recent' && !isThisMonth(tag.createdAt)) return false
      // 「自動付与あり」は手動を含まない。手動は自動ではない。
      if (key === 'auto' && (!tag.assignSource || tag.assignSource === 'manual')) return false
      if (key === 'linked' && !linked) return false
      if (key === 'starred' && !tag.isStarred) return false
    }
    return true
  }), [items, query, folder, usageFilter, sourceFilter, quick])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => setPage(1), [query, folder, usageFilter, sourceFilter, quick, pageSize])

  /**
   * 中身を出してよいか。**読み込み中・失敗・権限不足のあいだは数を出さない。**
   * 0件と出すと「登録したものが消えた」ように見える。`—` に留める。
   */
  const ready = status === 'ready'

  /*
    整理候補の数。**未取得は `null`（画面では `—`）、取得できて0件は `0`。**
    `—` と `0件` を混ぜない（`docs/v6-4-1-handoff.md` §0-1）。
  */
  const cleanupItems = items
  const cleanupCount = cleanupKnown(cleanupItems, ready)
    ? cleanupItems.filter((tag) => (tag.cleanupReasons?.length ?? 0) > 0).length
    : null
  const unusedCount = cleanupKnown(cleanupItems, ready)
    ? cleanupItems.filter((tag) => tag.cleanupReasons?.includes('unused')).length
    : null

  const move = async (targetId: string) => {
    if (!dragId || dragId === targetId) return setDragId(null)
    const order = filtered.map((tag) => tag.id)
    const from = order.indexOf(dragId); const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    const rank = new Map(order.map((id, index) => [id, index]))
    setItems((current) => [...current].sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999)))
    const result = await api.tags.reorder(order)
    if (!result.success) { setError(result.error); void load() }
  }

  /** 友だち一覧への表示（★）。設計 `zMlMX`。押した瞬間に切り替える。 */
  const toggleStar = async (tag: Tag) => {
    try {
      const res = await api.tags.update(tag.id, { isStarred: !tag.isStarred })
      if (!res.success) throw new Error(res.error)
      void load()
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '表示の切り替えに失敗しました')
    }
  }

  return (
    <div>
      {/*
        タイトルと説明は共通トップバーが持つ。本文には置かない
        （docs/v6-common-rules.md §1）。
        ヘッダー操作は独立した行にせず、タブ行の右端へ寄せる
        （docs/v6-common-rules.md §1-4、Pencil `aToSv` は space_between）。
      */}
      {/*
        設計の節の印。`design-structure.json` の `/tags` と突き合わせる。
        V6では見出し操作（`Head`）と4タブ（`GroupTabs`）が1行に同居するので、
        `Head` の中に `GroupTabs` を入れる。**印だけで、見た目は持たない。**
      */}
      <div data-design="Head">
        <div data-design="GroupTabs">
      <Tabs
        className="mb-4"
        items={TABS.map(([key, label]) => ({
          label,
          current: tab === key,
          onClick: () => fixture ? setFixtureTab(key) : router.replace(key === 'tags' ? '/tags' : `/tags?tab=${key}`),
        }))}
        actions={tab === 'tags' && status !== 'forbidden' ? (
          /*
            設計 `Sn86o` はここに CSV だけ。作る操作は KPI の下（`HWP5R`）。
            `H374MR` から確認 `sfTEW`、完了 `op1rh`、一部失敗 `QzRsJ`
            まで同じ操作の中で進む。
          */
          <Button type="button" onClick={() => setCsvOpen(true)}>CSVで一括登録</Button>
        ) : tab === 'marks' ? (
          <Button href="/tags/marks/new" variant="primary">＋ マークを追加</Button>
        ) : tab === 'fields' ? (
          <Button href="/tags/fields/new" variant="primary">＋ 項目を追加</Button>
        ) : undefined}
      />
        </div>
      </div>

      {csvOpen ? (
        <TagCsvImportDialog
          open
          onClose={() => setCsvOpen(false)}
          onCompleted={() => void load()}
        />
      ) : null}

      {/*
        設計の `Body`。タブごとに中身が入れ替わるので、4つ分をまとめて包む。
        `KPIs` はタブごとに数が変わるため、この中に入る。
      */}
      <div data-design="Body">
      {tab === 'tags' ? <>
        {/*
          一覧の数は **サーバーが数えて返す**（`/api/list-stats`）。
          タグ一覧から計算しない。「付与済み友だち」は人の数で、タグごとの
          人数を足した数ではない（2つタグが付いた人を2人と数えてしまう）。
          「今月の付与」も、いま画面に出ている一覧からは分からない。
          設計 `mfmn3` の4枚。
        */}
        {/*
          「未使用」と「整理候補」は **`cleanupReasons` から数える**。
          `stats.tags.unused` は読まない。同じ画面のKPI・絞り込み・使用先が
          別々の数え方をすると、数が食い違った理由を誰も追えなくなる。

          設計 `qN3YX` の絵は 26件（未使用 24件とは別の数）。
          整理候補 = 未使用 ∪ 重複名で、両方に当たっても**タグ1つ**と数える。
          `cleanupReasons` がタグごとに返るので、重複除外は自動で効く。
        */}
        <div data-design="KPIs">
        <ListKpis
          titles={['タグ数', '付与済み友だち', '今月の付与', '整理候補']}
          build={(stats) => [
            {
              title: 'タグ数',
              value: stats.tags.total,
              unit: '件',
              // 未取得は `—`、取得できて0件なら `0件`。
              detail: `未使用 ${unusedCount === null ? '—' : `${unusedCount}件`}`,
            },
            { title: '付与済み友だち', value: stats.tags.taggedFriends, unit: '人', detail: '1つ以上付与' },
            { title: '今月の付与', value: stats.tags.assignedThisMonth, unit: '回', detail: '手動・自動' },
            { title: '整理候補', value: cleanupCount, unit: cleanupCount === null ? '' : '件', detail: '未使用・重複名' },
          ]}
        />
        </div>

        {/*
          設計 `HWP5R`。作る操作はここ。左に置く（`v6-common-rules.md` §1-5）。
          **権限が無いときは出さない。** 押せるように見せてから断ると、
          何が足りないのかが分からないまま拒まれることになる。
        */}
        {status === 'forbidden' ? null : (
          <div className="mb-4 flex items-center gap-2">
            <Button href="/tags/folders/new">フォルダを追加</Button>
            <Button href="/tags/new" variant="primary">＋ タグを追加</Button>
          </div>
        )}
        {error && <p className="mb-4 rounded-control border border-danger/20 bg-danger-bg p-3 text-sm text-danger">{error}</p>}
        {/* 設計 `HrwyW` は gap 14、フォルダは 240 固定（`DgeL8`）。 */}
        <div className="grid min-w-0 gap-[14px] xl:grid-cols-[240px_minmax(0,1fr)]">
          <FolderList groups={groups} items={items} countsKnown={ready} active={folder} onSelect={setFolder} onChanged={() => void load()} />
          <main className="min-w-0">
            {/*
              設計 `XchZz タグツールバー`。左に検索群（`RAlQh` 405px＝
              検索144・使用状態129・付与元116）、右に表示件数と範囲（`Olp2S`）。
              **検索欄を伸ばさない。** 伸ばすと右の2つが端へ飛んで、
              設計の並びと変わる。
            */}
            <div className="mb-[10px] flex flex-wrap items-center gap-2">
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タグ名・用途で検索" className="h-9 w-[144px] rounded-control border border-hairline bg-canvas px-2 text-label outline-none focus:border-accent" />
              <select value={usageFilter} onChange={(event) => setUsageFilter(event.target.value)} className="v6-select v6-select-tight h-9 w-[129px] rounded-control border border-hairline bg-canvas text-label font-semibold text-ink"><option value="all">使用状態：すべて</option><option value="linked">連動あり</option><option value="unused">未使用</option></select>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="v6-select v6-select-tight h-9 w-[116px] rounded-control border border-hairline bg-canvas text-label font-semibold text-ink"><option value="all">付与元：すべて</option>{Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <span className="flex-1" />
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="v6-select h-9 rounded-control border border-hairline bg-canvas pl-3 text-label font-semibold text-ink">{[20,30,40,50].map((size) => <option key={size} value={size}>{size}件表示</option>)}</select>
              <span className="text-xs tabular-nums text-ink-faint">{ready ? `${filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} / ${filtered.length}件` : '—'}</span>
            </div>
            {/* 設計 `UOmne`。**5つ。押した数だけ重ねて絞る。** */}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-ink-faint">よく使う</span>
              {QUICK_FILTERS.map(([key, label]) => {
                const on = quick.includes(key)
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setQuick((current) => on ? current.filter((k) => k !== key) : [...current, key])}
                    className={`rounded-pill border px-3 py-1.5 ${on ? 'border-accent bg-accent-soft text-accent' : 'border-hairline bg-canvas text-ink-secondary'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {/*
              中身が詰まったら**表だけ**横スクロールさせる。
              画面ごと横に伸ばすと、共通ルール §1-8 の「1440でも横スクロールを
              出さない」を破る。逃がす先を表の中に閉じる。
            */}
            <div className={`overflow-hidden rounded-card border border-hairline bg-canvas ${cardShadow}`}>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] table-fixed text-sm">
                {/* 設計 `HrwyW` の見出し。「表示」は★、「操作」はゴミ箱だけ。 */}
                <thead className="border-b border-hairline bg-canvas-sunken text-[11px] text-ink-faint">
                  <tr>
                    <th className="w-9 px-2 py-3" />
                    <th className="w-[19%] px-3 py-3 text-left">タグ</th>
                    <th className="w-[10%] px-3 py-3 text-left">フォルダ</th>
                    <th className="w-[7%] px-3 py-3 text-left">付与人数</th>
                    <th className="w-[11%] px-3 py-3 text-left">自動付与のもと</th>
                    <th className="w-[20%] px-3 py-3 text-left">連動（マイル・アクション）</th>
                    <th className="w-[12%] px-3 py-3 text-left">使用先</th>
                    <th className="w-[9%] px-3 py-3 text-left">登録日</th>
                    <th className="w-[6%] px-3 py-3 text-left">表示</th>
                    <th className="w-[6%] px-3 py-3 text-left">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {/*
                    **4状態を言い分ける。** 設計 ★V6 4-2-C `yKEdO` は、見出し行を
                    残したまま本文のところへ 132px の1枚を出す。
                    `visible.length === 0` だけを見て「ありません」と出すと、
                    読み込みに失敗したときも同じ文が出る（PR #216 と同じ壊れ方）。
                  */}
                  {status === 'loading' ? (
                    <tr><td colSpan={10} className="p-0"><ListState kind="loading" /></td></tr>
                  ) : status === 'forbidden' ? (
                    <tr><td colSpan={10} className="p-0"><ListState kind="forbidden" description="タグを見るには権限が要ります。オーナーか管理者に追加を依頼してください。" /></td></tr>
                  ) : status === 'error' ? (
                    <tr><td colSpan={10} className="p-0"><ListState kind="error" description="タグを読み込めませんでした。再読み込みしても直らない場合はエラー報告へ。" onRetry={() => void load()} /></td></tr>
                  ) : items.length === 0 ? (
                    // まだ1件も作っていない。「条件を変える」は言えない。
                    <tr><td colSpan={10} className="p-0"><ListState kind="empty" title="まだタグがありません" description="「＋ タグを追加」から最初の1つを作ると、ここに並びます。" /></td></tr>
                  ) : visible.length === 0 ? (
                    // 作ってはあるが、いまの絞り込みに合うものが無い。
                    <tr><td colSpan={10} className="p-0"><ListState kind="empty" title="条件に合うタグはありません" description="検索語・フォルダ・絞り込みを変えてください。" /></td></tr>
                  ) : visible.map((tag) => {
                    const group = groups.find((item) => item.id === tag.groupId)
                    const chips = linkChips(tag)
                    return (
                      <tr key={tag.id} className="hover:bg-canvas-sunken">
                        {/*
                          並び替えのつまみ。設計 `i1Xb2V` は**常に出す**。
                          「並び替え」ボタンで出し入れしない。押す前は
                          並び替えられることに気づけないため。
                        */}
                        <td
                          draggable
                          onDragStart={() => setDragId(tag.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => void move(tag.id)}
                          className="cursor-grab px-2 py-3 text-center text-hairline"
                          aria-label="ドラッグして並び替え"
                        >
                          <GripIcon />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group?.color ?? '#8b938d' }} />
                            {/* 設計 `VQykB` は青文字。押すと編集へ行く（編集ボタンは置かない）。 */}
                            <Link href={`/tags/edit?id=${tag.id}`} className="truncate text-label font-semibold text-status-info hover:underline" title={tag.name}>{tag.name}</Link>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <FolderSelect tag={tag} groups={groups} onChanged={() => void load()} />
                        </td>
                        <td className="px-3 py-3 text-label tabular-nums">{tag.friendCount ?? 0}人</td>
                        <td className="truncate px-3 py-3 text-label text-ink" title={sourceLabel(tag)}>{sourceLabel(tag)}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {chips.length === 0
                              ? <span className="text-xs text-ink-faint">—</span>
                              : chips.map((chip) => (
                                  <span key={chip.label} className={`rounded-mini px-[7px] py-[2px] text-micro font-semibold ${chip.tone}`}>{chip.label}</span>
                                ))}
                          </div>
                        </td>
                        <td className="truncate px-3 py-3 text-label text-ink">{usageLabel(tag)}</td>
                        <td className="px-3 py-3 text-label text-ink">{formatDate(tag.createdAt)}</td>
                        <td className="px-3 py-3">
                          {/* 設計 `zMlMX`。押すと友だち一覧への表示を切り替える。 */}
                          <button
                            type="button"
                            aria-pressed={Boolean(tag.isStarred)}
                            aria-label={tag.isStarred ? '友だち一覧に表示しない' : '友だち一覧に表示する'}
                            onClick={() => void toggleStar(tag)}
                            className={tag.isStarred ? 'text-status-warn-deep' : 'text-hairline hover:text-status-warn-deep'}
                          >
                            <StarIcon filled={Boolean(tag.isStarred)} />
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          {/* 設計 `E2NC4`。赤いゴミ箱だけ。文字の「削除」は置かない。 */}
                          <button type="button" onClick={() => setDeleteTarget(tag)} aria-label={`${tag.name} を削除`} className="text-danger hover:opacity-70">
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
              {/*
                設計 `Blot6`。共通部品を使う。ここで自前に組むと、
                高さ38・角丸・現在ページの緑がほかの一覧とずれる。
              */}
            </div>
          </main>
        </div>
        {/*
          設計 `rvzSw タグ フッター`。**表の枠の外**、本体の幅いっぱいで右寄せ。
          枠の中に入れると、フォルダの列だけ高さが余ったときに位置がずれる。
          中身を出せていないときは出さない（ページ番号があると読めて見える）。
        */}
        {ready ? (
          <div className="mt-[14px] flex items-center justify-end">
            <Pagination page={currentPage} pageCount={pages} onPageChange={setPage} />
          </div>
        ) : null}
      </> : tab === 'fields' ? <FriendFieldList accountId={accountId} /> : tab === 'marks' ? <SupportMarkList accountId={accountId} /> : <SavedSearchList accountId={accountId} />}
      </div>
      {deleteTarget && <DeleteTagDialog tag={deleteTarget} onCancel={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); void load() }} />}
    </div>
  )
}
