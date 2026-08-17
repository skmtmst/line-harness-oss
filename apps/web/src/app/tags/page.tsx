'use client'

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Header from '@/components/layout/header'
import ListKpis from '@/components/shared/list-kpis'
import ListToolbar from '@/components/shared/list-toolbar'
import FolderPanel from '@/components/shared/folder-panel'
import TagBadge from '@/components/friends/tag-badge'
import FriendFieldList from '@/components/friend-fields/field-list'
import SupportMarkList from '@/components/friend-fields/mark-list'
import SavedSearchList from '@/components/friend-fields/saved-search-list'

const PRESET_COLORS = [
  '#3B82F6', // blue (server default)
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#6B7280', // gray
]

function TagMileageEditor({ tag, onSaved }: { tag: Tag; onSaved: () => void }) {
  const [reward, setReward] = useState(String(tag.mileageReward ?? 0))
  const [referralReward, setReferralReward] = useState(String(tag.referralMileageReward ?? 0))
  const [multiplier, setMultiplier] = useState(
    tag.mileageMultiplierBps == null ? '' : String(tag.mileageMultiplierBps / 10000),
  )
  const [priority, setPriority] = useState(String(tag.mileageMultiplierPriority ?? 0))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const rewardMiles = Number(reward)
    const referralRewardMiles = Number(referralReward)
    const multiplierBps = multiplier.trim() === '' ? null : Math.round(Number(multiplier) * 10000)
    const multiplierPriority = Number(priority)
    if (!Number.isInteger(rewardMiles) || rewardMiles < 0) return
    if (!Number.isInteger(referralRewardMiles) || referralRewardMiles < 0) return
    if (multiplierBps !== null && (!Number.isInteger(multiplierBps) || multiplierBps < 1000 || multiplierBps > 100000)) return
    if (!Number.isInteger(multiplierPriority) || multiplierPriority < 0) return
    setSaving(true)
    try {
      await api.tags.updateMileage(tag.id, {
        rewardMiles,
        referralRewardMiles,
        multiplierBps,
        multiplierPriority,
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <td className="px-3 py-3">
        <input
          aria-label={`${tag.name}の獲得マイル`}
          type="number"
          min={0}
          step={1}
          value={reward}
          onChange={(e) => setReward(e.target.value)}
          className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-md tabular-nums"
        />
      </td>
      <td className="px-3 py-3">
        <input
          aria-label={`${tag.name}の紹介者マイル`}
          type="number"
          min={0}
          step={1}
          value={referralReward}
          onChange={(e) => setReferralReward(e.target.value)}
          className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-md tabular-nums"
        />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1">
          <input
            aria-label={`${tag.name}の還元倍率`}
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            placeholder="なし"
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
            className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-md tabular-nums"
          />
          <span className="text-xs text-ink-faint">倍</span>
        </div>
      </td>
      <td className="px-3 py-3">
        <input
          aria-label={`${tag.name}の倍率優先度`}
          type="number"
          min={0}
          max={1000}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="w-16 px-2 py-1.5 text-sm border border-gray-300 rounded-md tabular-nums"
        />
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        <button
          onClick={save}
          disabled={saving}
          className="px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 rounded-md disabled:opacity-40"
        >
          {saving ? '保存中' : 'マイル保存'}
        </button>
      </td>
    </>
  )
}

/** 「未分類」を表す絞り込みの値。空文字だと「すべて」と区別できない。 */
const UNGROUPED = '__ungrouped__'

/**
 * 分類ごとにタグを並べる一行。分類の付け替えは一覧から直接できるようにする。
 * 編集画面を開かせると、10個並べ替えるのに10回開くことになる。
 */
function TagGroupSelect({
  tag,
  groups,
  onChanged,
}: {
  tag: Tag
  groups: TagGroup[]
  onChanged: () => void
}) {
  const [saving, setSaving] = useState(false)
  return (
    <select
      aria-label={`${tag.name}の分類`}
      value={tag.groupId ?? ''}
      disabled={saving}
      onChange={async (e) => {
        const next = e.target.value === '' ? null : e.target.value
        setSaving(true)
        try {
          await api.tags.setGroup(tag.id, next)
          onChanged()
        } finally {
          setSaving(false)
        }
      }}
      className="border-hairline rounded-control max-w-[10rem] border px-2 py-1.5 text-sm disabled:opacity-40"
    >
      <option value="">未分類</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  )
}

/** 友だち属性の4タブ。URLに出して、ブラウザバックとブックマークを壊さない。 */
const TABS = [
  { key: 'tags', label: 'タグ' },
  { key: 'fields', label: '友だち情報欄' },
  { key: 'marks', label: '対応マーク' },
  { key: 'searches', label: '保存した検索' },
] as const
type TabKey = (typeof TABS)[number]['key']

/**
 * タブごとの説明。設計は4タブそれぞれに別の説明を置いている。
 * 1つに固定すると、開いているタブと説明が食い違う。
 */
const TAB_DESCRIPTIONS: Record<TabKey, string> = {
  tags: '友だちを分類するタグを管理します。タグはシナリオの開始条件、配信の絞り込み、自動応答の付与先として使えます。',
  fields:
    '「愛犬のお名前」「便の状態」など、友だちごとに記録したい項目を定義します。ここで作った項目が、回答フォームの登録先・友だち詳細のタブ・テンプレートの差し込みに使えます。',
  marks:
    '問い合わせの状態を表すマークを作ります。ここで決めた選択肢が、受信箱・友だち一覧・友だち詳細で使われます。',
  searches:
    '友だちの絞り込み条件に名前を付けて保存します。保存した条件は、友だち一覧・配信の宛先・オートメーションの対象から呼び出せます。',
}

function TagsPageInner() {
  const [items, setItems] = useState<Tag[]>([])
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [creating, setCreating] = useState(false)
  // タグ名の絞り込み（設計 `Body` の「タグ名で検索」）。
  const [tagQuery, setTagQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [newGroupId, setNewGroupId] = useState('')
  const [saving, setSaving] = useState(false)

  const router = useRouter()
  const params = useSearchParams()
  const rawTab = params.get('tab')
  const tab: TabKey = (TABS.find((t) => t.key === rawTab)?.key ?? 'tags') as TabKey

  const [filter, setFilter] = useState<string>('')
  /** よく使う絞り込み。いま数えられるのは「未使用のタグ」だけ。 */
  const [quickFilter, setQuickFilter] = useState<'' | 'unused'>('')
  const [groupName, setGroupName] = useState('')
  const [addingGroup, setAddingGroup] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [tagsRes, groupsRes] = await Promise.all([
        api.tags.list({ withCounts: true }),
        api.tagGroups.list(),
      ])
      if (tagsRes.success) setItems(tagsRes.data)
      if (groupsRes.success) setGroups(groupsRes.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    // 名前は手元で絞る。打つたびに取り直すと重い。
    const q = tagQuery.trim().toLowerCase()
    let out = q === '' ? items : items.filter((t) => t.name.toLowerCase().includes(q))
    // 誰にも付いていないタグ。整理するときに使う。
    if (quickFilter === 'unused') out = out.filter((t) => (t.friendCount ?? 0) === 0)
    if (filter === '') return out
    if (filter === UNGROUPED) return out.filter((t) => !t.groupId)
    return out.filter((t) => t.groupId === filter)
  }, [items, filter, tagQuery, quickFilter])

  const ungroupedCount = useMemo(() => items.filter((t) => !t.groupId).length, [items])

  /** 友だち一覧に出す・出さないを切り替える。 */
  const toggleStar = async (tag: Tag) => {
    setError('')
    // 押した瞬間に見た目を変える。往復を待つと、押せたかどうか分からない。
    setItems((prev) => prev.map((t) => (t.id === tag.id ? { ...t, isStarred: !t.isStarred } : t)))
    try {
      await api.tags.update(tag.id, { isStarred: !tag.isStarred })
    } catch {
      setError('表示の切り替えに失敗しました')
      void load()
    }
  }

  const handleAddGroup = async () => {
    const name = groupName.trim()
    if (!name) return
    if (groups.some((g) => g.name === name)) {
      setError(`分類「${name}」は既にあります`)
      return
    }
    setAddingGroup(true)
    setError('')
    try {
      await api.tagGroups.create({ name, sortOrder: groups.length })
      setGroupName('')
      load()
    } catch {
      setError('分類の作成に失敗しました')
    } finally {
      setAddingGroup(false)
    }
  }

  const handleDeleteGroup = async (group: TagGroup) => {
    const count = items.filter((t) => t.groupId === group.id).length
    const message =
      count > 0
        ? `分類「${group.name}」を削除しますか？\n${count} 個のタグは削除されず、未分類に戻ります。`
        : `分類「${group.name}」を削除しますか？`
    if (!confirm(message)) return
    setError('')
    try {
      await api.tagGroups.delete(group.id)
      if (filter === group.id) setFilter('')
      load()
    } catch {
      setError('分類の削除に失敗しました')
    }
  }

  const handleCreate = async () => {
    if (saving) return
    const name = newName.trim()
    if (!name) return
    if (items.some((t) => t.name === name)) {
      setError(`タグ「${name}」は既に存在します`)
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.tags.create({ name, color: newColor, groupId: newGroupId || null })
      setNewName('')
      setCreating(false)
      load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(`タグ「${name}」は既に存在します`)
        load()
      } else {
        setError('作成に失敗しました')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (tag: Tag) => {
    const count = tag.friendCount ?? 0
    const message = count > 0
      ? `タグ「${tag.name}」は ${count} 人の友だちに付与されています。\n削除すると全員からこのタグが外れます。よろしいですか？`
      : `タグ「${tag.name}」を削除しますか？`
    if (!confirm(message)) return
    setError('')
    try {
      await api.tags.delete(tag.id)
      load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(`タグ「${tag.name}」はアフィリエイトオファー等で使用中のため削除できません`)
      } else {
        setError('削除に失敗しました')
      }
    }
  }

  return (
    <div>
      <div data-design="Head">
      <Header
        title="友だち属性"
        description={TAB_DESCRIPTIONS[tab]}
        action={
          tab === 'tags' ? (
            <div className="flex flex-wrap items-center gap-2">
              {['マニュアル', 'CSVで一括登録', '並び替え', 'フォルダを追加'].map((label) => (
                <button
                  key={label}
                  disabled
                  title="準備中です"
                  className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
                >
                  {label}
                </button>
              ))}
              {/* 設計の呼び名。作る場所も専用の画面（3-1-1）に寄せる。 */}
              <Link
                href="/tags/new"
                className="bg-accent text-on-accent rounded-control px-4 py-2 text-sm font-medium transition-colors hover:bg-accent-hover"
              >
                ＋ タグを追加
              </Link>
            </div>
          ) : tab === 'fields' ? (
            <a href="/tags/fields/new" className="bg-accent text-on-accent rounded-control px-4 py-2 text-sm font-medium hover:bg-accent-hover">
              項目を追加
            </a>
          ) : undefined
        }
      />
      </div>

      {/* 設計の KPI 4枚。数は /api/list-stats から4画面ぶんまとめて来る。 */}
      {/*
        タブごとに出す数を変える。設計では4タブそれぞれに別のKPIが載っている。
        タブを切り替えたのに数字が前のままだと、どのタブの数か分からなくなる。
      */}
      <div data-design="KPIs">
      <ListKpis
        key={tab}
        build={(s) =>
          tab === 'marks'
            ? [
                { title: 'マークの種類', value: s.marks.total, unit: '件', detail: `使用中 ${s.marks.inUse}` },
                {
                  title: '未対応',
                  value: s.marks.unanswered,
                  unit: '人',
                  detail:
                    s.tags.taggedFriends > 0
                      ? `全体の ${Math.round((s.marks.unanswered / s.tags.taggedFriends) * 1000) / 10}%`
                      : '—',
                },
                { title: '対応中', value: s.marks.inProgress, unit: '人', detail: '担当者あり' },
                // 設計の4枚目。110 の操作記録から出す。
                // 当てた日より前の変更は記録が無いので入らない。
                { title: 'マークの変更', value: s.marks.changedLast7, unit: '回', detail: '過去7日' },
              ]
            : tab === 'searches'
              ? [
                  { title: '保存した条件', value: s.searches.total, unit: '件', detail: `上限 ${s.searches.limit}` },
                  // 設計の「配信で使用中」「該当者が0人」「今月の呼び出し」は、
                  // 使われ方を記録していないので出せない。
                  // docs/v025-open-questions.md に残している。
                  { title: '空き', value: s.searches.limit - s.searches.total, unit: '件', detail: 'あと保存できる数' },
                  { title: 'タグ数', value: s.tags.total, unit: '件', detail: '条件に使える' },
                  { title: '友だち情報欄', value: null, unit: '件', detail: '条件に使える' },
                ]
              : [
            { title: 'タグ数', value: s.tags.total, unit: '件', detail: `うち未使用 ${s.tags.unused}` },
            {
              title: '付与済み友だち',
              value: s.tags.taggedFriends,
              unit: '人',
              detail: 'タグが1つ以上ついている人',
            },
            {
              title: '今月の付与',
              value: s.tags.assignedThisMonth,
              unit: '回',
              detail: '手動・自動の合計',
            },
            // 設計の4枚目は「自動付与ルール」。自動応答・フォーム由来の
            // 付与ルールを数える口がまだ無いので、未使用タグを出す。
            // どちらも「整理が要るか」を見るための数。
                  { title: '未使用のタグ', value: s.tags.unused, unit: '件', detail: '誰にもついていない' },
                ]
        }
      />
      </div>

      {/* タブ（設計 `GroupTabs`）。 */}
      <div data-design="GroupTabs" />

      <div data-design="Body">

      {/* タブはURLに出す。直リンクとブラウザバックが効くようにするため。 */}
      <div className="border-hairline mb-5 flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => router.replace(`/tags?tab=${t.key}`)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-accent text-accent'
                : 'text-ink-secondary hover:text-ink border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/*
        タブごとの説明（設計 `V2 3-1〜3-4`）。
        設計はどのタブにも「この画面が何をする場所か」を最初に書いている。
        タグ・情報欄・対応マーク・保存した検索は、名前だけでは
        何のためのものか分からない。使う前に読む1文を置く。
      */}
      {tab === 'fields' && (
        <>
          <p className="text-ink-secondary rounded-card border-hairline bg-canvas mb-4 border p-4 text-sm leading-relaxed">
            「愛犬のお名前」「便の状態」など、友だちごとに記録したい項目を定義します。
            ここで作った項目が、<strong>回答フォームの登録先</strong>・
            <strong>友だち詳細のタブ</strong>・<strong>テンプレートの差し込み</strong>に使えます。
          </p>
          <FriendFieldList />
        </>
      )}
      {tab === 'marks' && (
        <>
          <p className="text-ink-secondary rounded-card border-hairline bg-canvas mb-4 border p-4 text-sm leading-relaxed">
            問い合わせの状態を表すマークを作ります。ここで決めた選択肢が、
            <strong>受信箱</strong>・<strong>友だち一覧</strong>・<strong>友だち詳細</strong>で使われます。
          </p>
          <SupportMarkList />
          <div className="text-ink-faint rounded-card border-hairline bg-canvas-sunken mt-4 border p-4 text-xs leading-relaxed">
            <p className="text-ink-secondary mb-1.5 font-medium">気をつけること</p>
            <ul className="space-y-1">
              <li>・使用中のマークを削除すると、そのマークが付いている友だちは「未対応」に戻ります</li>
              <li>・初期値のマークは1つだけ選べます。新しい友だちにはこれが付きます</li>
              <li>・並び順は、受信箱や一覧の絞り込みボタンの並びに反映されます</li>
            </ul>
          </div>
        </>
      )}
      {tab === 'searches' && (
        <>
          <p className="text-ink-secondary rounded-card border-hairline bg-canvas mb-4 border p-4 text-sm leading-relaxed">
            友だちの絞り込み条件に名前を付けて保存します。保存した条件は、
            <strong>友だち一覧</strong>・<strong>配信の宛先</strong>・
            <strong>オートメーションの対象</strong>から呼び出せます。
          </p>
          <SavedSearchList />
          <div className="text-ink-faint rounded-card border-hairline bg-canvas-sunken mt-4 border p-4 text-xs leading-relaxed">
            <p className="text-ink-secondary mb-1.5 font-medium">条件の組み方</p>
            <ul className="space-y-1">
              <li>・「すべて満たす」と「いずれか1つ以上満たす」の2つのグループに分けて指定します</li>
              <li>・両方に条件を入れると、すべて満たす かつ いずれか1つ以上満たす、という意味になります</li>
              <li>・保存できるのは50件までです</li>
            </ul>
            <p className="text-ink-secondary mt-3 mb-1.5 font-medium">使える条件</p>
            <ul className="space-y-1">
              <li>・タグ ／ 友だち情報欄 ／ 対応マーク ／ 流入経路 ／ 購読中のシナリオ</li>
              <li>・最終接触日 ／ 友だち追加日 ／ 最終購入日 ／ 誕生日</li>
              <li>・フォームの回答内容 ／ サイトの行動 ／ 購入履歴 ／ マイル残高</li>
            </ul>
          </div>
        </>
      )}

      {tab === 'tags' && (
      <>
      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/*
        設計はフォルダを左の縦パネルに置く。以前は一覧の上に横の帯として
        並べていたが、分類が増えると折り返して2段3段になり、その下の
        検索や表が押し下げられていた。縦なら増えても幅が変わらない。
      */}
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <FolderPanel
          total={`${items.length} 件`}
          activeId={filter}
          onSelect={setFilter}
          rows={[
            { id: '', label: 'すべて', count: items.length },
            ...groups.map((g) => ({
              id: g.id,
              label: g.name,
              count: items.filter((t) => t.groupId === g.id).length,
              onDelete: () => handleDeleteGroup(g),
            })),
            { id: UNGROUPED, label: '未分類', count: ungroupedCount },
          ]}
        >
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddGroup() }}
            placeholder="例: お悩み"
            aria-label="新しい分類名"
            className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
          />
          <button
            onClick={handleAddGroup}
            disabled={addingGroup || !groupName.trim()}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken w-full border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            {addingGroup ? '追加中...' : 'フォルダを追加'}
          </button>
          <p className="text-ink-faint text-xs leading-relaxed">
            フォルダを削除しても、属していたタグは未分類として残ります。
          </p>
        </FolderPanel>

        <div>
        <ListToolbar
          searchPlaceholder="タグ名で検索"
          searchValue={tagQuery}
          onSearchChange={setTagQuery}
          sortLabel="付与人数が多い順"
        />

        {/*
          よく使う絞り込み（設計の絵の帯）。数え方が決まっているのは
          「未使用のタグ」だけ。ほかは何をもってそう呼ぶかを決める前に
          出すと、押した人ごとに違うものを想像する。押せない形で置く。
        */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-ink-faint text-xs">よく使う</span>
          <button
            onClick={() => setQuickFilter(quickFilter === 'unused' ? '' : 'unused')}
            className={`rounded-pill px-3 py-1 text-xs transition-colors ${
              quickFilter === 'unused'
                ? 'bg-accent-soft text-accent'
                : 'border-hairline text-ink-secondary hover:bg-canvas-sunken border'
            }`}
          >
            未使用のタグ
          </button>
          {['今月増えたタグ', '自動付与あり'].map((label) => (
            <button
              key={label}
              disabled
              title="この絞り込みはまだ数えられません"
              className="border-hairline text-ink-faint rounded-pill border px-3 py-1 text-xs opacity-50"
            >
              {label}
            </button>
          ))}
        </div>

      {creating && (
        <div className="mb-4 p-4 bg-canvas rounded-card border border-hairline">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-ink-faint mb-1.5">タグ名</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                placeholder="例: 見込み客"
                autoFocus
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-faint mb-1.5">色</label>
              <div className="flex items-center gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className={`w-7 h-7 rounded-full transition-transform ${newColor === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                    aria-label={`色 ${c}`}
                  />
                ))}
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-7 h-7 p-0 border border-gray-300 rounded cursor-pointer"
                  title="カスタム色"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="new-tag-group"
                className="block text-xs font-semibold text-ink-faint mb-1.5"
              >
                分類
              </label>
              <select
                id="new-tag-group"
                value={newGroupId}
                onChange={(e) => setNewGroupId(e.target.value)}
                className="border-hairline rounded-control border px-3 py-2 text-sm"
              >
                <option value="">未分類</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={saving || !newName.trim()}
                className="bg-accent text-on-accent rounded-control px-4 py-2 text-sm font-medium transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                {saving ? '作成中...' : '作成'}
              </button>
              <button
                onClick={() => { setCreating(false); setNewName('') }}
                className="px-4 py-2 text-sm font-medium text-ink-secondary bg-canvas-sunken hover:bg-gray-200 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-canvas rounded-card border border-hairline overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px]">
            <thead>
              {/*
                列は設計の絵の並び。以前は獲得マイル・紹介者マイル・行動倍率・
                優先度の4列をここで直接いじれるようにしていたが、絵には無い。
                倍率は「タグを作る」側にあるものなので、編集画面へ移した。
                一覧は「どのタグが誰に何人付いているか」を見る場所に戻す。
              */}
              <tr className="bg-canvas-sunken border-b border-hairline">
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">タグ名</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">友だち人数</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">自動付与のもと</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">分類</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">登録日</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">表示</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-faint text-sm">読み込み中...</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-faint text-sm">
                  {items.length === 0 ? 'タグがありません' : 'この分類のタグはありません'}
                </td></tr>
              ) : (
                visible.map((t) => (
                  <tr key={t.id} className="hover:bg-canvas-sunken">
                    <td className="px-4 py-3">
                      {/* 名前から編集へ入る。倍率もそちらにある。 */}
                      <Link href={`/tags/edit?id=${t.id}`} className="hover:underline">
                        <TagBadge tag={t} />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-secondary tabular-nums">
                      {t.friendCount ?? 0}
                      <span className="text-xs text-ink-faint ml-0.5">人</span>
                    </td>
                    {/*
                      何をきっかけに自動で付いたタグかを出す列。きっかけは
                      回答フォームやオートメーションの側に置かれていて、
                      タグから引く口が無い。列だけ先に置く。
                    */}
                    <td className="px-4 py-3 text-xs text-ink-faint">—</td>
                    <td className="px-4 py-3">
                      <TagGroupSelect tag={t} groups={groups} onChanged={load} />
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-faint">
                      {t.createdAt ? new Date(t.createdAt).toLocaleDateString('ja-JP') : ''}
                    </td>
                    {/* 友だち一覧の「★つきタグ」列に出すか。ここから切り替える。
                        タグは何十個も作るので、全部並べると狭い列でどれも読めない。 */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleStar(t)}
                        title={t.isStarred ? '友だち一覧に出さない' : '友だち一覧に出す'}
                        className={`inline-flex items-center gap-1 text-xs ${
                          t.isStarred ? 'text-accent' : 'text-ink-faint hover:text-ink-secondary'
                        }`}
                      >
                        {t.isStarred ? '★ 一覧に表示' : '☆ —'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link
                        href={`/tags/edit?id=${t.id}`}
                        className="text-accent mr-2 px-2.5 py-1 text-xs font-medium hover:underline"
                      >
                        編集
                      </Link>
                      <button
                        onClick={() => handleDelete(t)}
                        className="px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-danger-bg rounded-md"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
        </div>
      </div>
      </>
      )}
      </div>
    </div>
  )
}

export default function TagsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <TagsPageInner />
    </Suspense>
  )
}
