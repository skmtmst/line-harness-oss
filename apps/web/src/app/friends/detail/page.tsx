'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { FriendField, Folder } from '@line-crm/shared'
import { api, type FriendDetail, type MileageSummary } from '@/lib/api'
import Header from '@/components/layout/header'
import TagBadge from '@/components/friends/tag-badge'
import { FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'
import FriendTimeline from '@/components/friends/friend-timeline'

/**
 * 友だち詳細。
 *
 * ルートが /friends/[id] ではなく /friends/detail?id= なのは、この管理画面が
 * 静的書き出し（next.config の output: 'export'）だから。動的セグメントは
 * ビルド時に全IDが分からないと書き出せない。既存の /scenarios/detail?id= や
 * /rich-menus/edit?id= と同じ形にそろえている。
 */

/**
 * 右カラムのタブ（友だちV4詳細設計）。
 *
 * `pending` は、出す先のデータを取る口がまだ無いもの。タブそのものを
 * 消すと設計と並びが変わるので、出したうえで何が足りないかを書く。
 */
const TABS = [
  { key: 'timeline', label: 'タイムライン' },
  { key: 'health', label: '健康記録', pending: '健康記録を残す仕組みがまだありません。' },
  { key: 'reminders', label: 'リマインダ', pending: 'この友だちのリマインダを引く口がまだありません。' },
  { key: 'actions', label: 'アクション', pending: '操作の履歴を残す仕組みがまだありません。' },
  { key: 'forms', label: 'フォーム回答' },
  { key: 'orders', label: '注文・定期便', pending: 'この友だちの注文を引く口がまだありません。' },
  { key: 'info', label: '情報欄' },
] as const
type TabKey = (typeof TABS)[number]['key']

/**
 * 上に並ぶ情報欄のグループ。既定の「基本」だけ固定で、あとは
 * 友だち情報欄のフォルダがそのまま並ぶ（飼い主情報・ペットプロフィール…）。
 *
 * 項目が増えると1枚の縦長なフォームになり、目的の項目まで
 * 延々と巻かないと届かない。分類でまとめて出す。
 */
const BASIC_GROUP = 'basic'

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FriendField
  value: string
  onChange: (v: string) => void
}) {
  const readOnly = field.ecIsMaster
  const base =
    'border-hairline rounded-control w-full border px-3 py-2 text-sm disabled:bg-canvas-sunken disabled:text-ink-faint'

  if (field.type === 'textarea') {
    return (
      <textarea
        rows={3}
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} resize-y`}
      />
    )
  }
  if (field.type === 'select' || field.type === 'multi_select') {
    // 複数選択も、いまは1つ選ぶ形にしている。複数選択のUIは
    // 値の持ち方（区切り文字）を決めてから作る。
    return (
      <select
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      >
        <option value="">— 未設定 —</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  if (field.type === 'checkbox') {
    return (
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={value === '1'}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.checked ? '1' : '')}
          className="rounded border-gray-300"
        />
        <span className="text-ink-secondary text-sm">はい</span>
      </label>
    )
  }
  const inputType =
    field.type === 'number'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'url'
          ? 'url'
          : field.type === 'tel'
            ? 'tel'
            : field.type === 'email'
              ? 'email'
              : 'text'
  return (
    <input
      type={inputType}
      value={value}
      disabled={readOnly}
      onChange={(e) => onChange(e.target.value)}
      className={base}
    />
  )
}

/**
 * 左の各節の見出し。右端に「編集」「すべて見る」「変更」が付く。
 *
 * 設計では節ごとに行き先が違う。ここで受けて、節の中身と離さない。
 */
function SectionHead({
  label,
  actionLabel,
  href,
}: {
  label: string
  actionLabel: string
  href: string
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <p className="text-ink-faint text-xs font-semibold">{label}</p>
      <Link href={href} className="text-accent shrink-0 text-xs hover:underline">
        {actionLabel}
      </Link>
    </div>
  )
}

/** 対応状況。やり取りがまだ無い友だちは、未対応でも対応済みでもない。 */
function SupportMarkBadge({ status }: { status?: 'unread' | 'in_progress' | 'on_hold' | 'resolved' }) {
  if (!status) return <span className="text-ink-faint text-xs">やり取りなし</span>
  const map = {
    unread: { label: '未対応', className: 'bg-warning-bg text-warning' },
    in_progress: { label: '対応中', className: 'bg-info-bg text-info' },
    on_hold: { label: '保留', className: 'bg-action-soft text-action' },
    resolved: { label: '対応済み', className: 'bg-success-bg text-success' },
  } as const
  const s = map[status]
  return (
    <span className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${s.className}`}>
      {s.label}
    </span>
  )
}

function FriendDetailInner() {
  const params = useSearchParams()
  const friendId = params.get('id') ?? ''
  const rawTab = params.get('tab')
  // 既定はタイムライン。設計でも最初に開くのはやり取り。
  const tab: TabKey = (TABS.find((t) => t.key === rawTab)?.key ?? 'timeline') as TabKey

  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [fields, setFields] = useState<FriendField[]>([])
  const [hiddenPersonalCount, setHiddenPersonalCount] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [mileage, setMileage] = useState<MileageSummary | null>(null)
  const [richMenu, setRichMenu] = useState<{ name: string | null; isDefault: boolean } | null>(null)
  const [groups, setGroups] = useState<Folder[]>([])
  const group = params.get('group') ?? BASIC_GROUP

  const load = useCallback(async () => {
    if (!friendId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      // マイル・リッチメニュー・フォルダは、取れなくても詳細は出す。
      const [friendRes, fieldsRes, mileageRes, menuRes, groupsRes] = await Promise.all([
        api.friends.get(friendId),
        api.friendFields.forFriend(friendId),
        api.friends.mileage(friendId, 1).catch(() => null),
        api.friends.richMenu(friendId).catch(() => null),
        api.folders.list('friend_field').catch(() => null),
      ])
      if (mileageRes?.success) setMileage(mileageRes.data.summary)
      if (menuRes?.success) setRichMenu(menuRes.data)
      if (groupsRes?.success) setGroups(groupsRes.data)
      if (friendRes.success) setFriend(friendRes.data)
      if (fieldsRes.success) {
        setFields(fieldsRes.data.items)
        setHiddenPersonalCount(fieldsRes.data.hiddenPersonalCount)
        const next: Record<string, string> = {}
        for (const f of fieldsRes.data.items) next[f.id] = f.value ?? ''
        setValues(next)
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [friendId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    setWarnings([])
    try {
      // 変わったものだけ送る。全部送ると、見ただけの項目にも
      // 更新の記録（updated_by / updated_at）が付いてしまう。
      const changed: Record<string, string | null> = {}
      for (const f of fields) {
        const before = f.value ?? ''
        const after = values[f.id] ?? ''
        if (before !== after) changed[f.id] = after === '' ? null : after
      }
      if (Object.keys(changed).length === 0) {
        setNotice('変更はありません')
        return
      }
      const res = await api.friendFields.saveForFriend(friendId, changed)
      if (!res.success) {
        setError(res.error)
        return
      }
      if (res.warnings?.length) setWarnings(res.warnings)
      setNotice(`${res.data.updated} 件を保存しました`)
      void load()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (!friendId) {
    return (
      <div>
        <Header title="友だち詳細" />
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          友だちが指定されていません。
          <Link href="/friends" className="text-accent ml-1 hover:underline">
            友だち一覧へ戻る
          </Link>
        </p>
      </div>
    )
  }

  /*
   * 上のタブで選んだグループの項目だけを編集の対象にする。「基本」は
   * 分類のない項目。★つきは基本のときだけ先頭へ寄せる。グループを
   * 開いているときは、その分類の中の並び順のほうが読みやすい。
   */
  const inGroup =
    group === BASIC_GROUP ? fields.filter((f) => !f.folderId) : fields.filter((f) => f.folderId === group)
  const starred = fields.filter((f) => f.isStarred)
  const groupStarred = group === BASIC_GROUP ? inGroup.filter((f) => f.isStarred) : []
  const rest = group === BASIC_GROUP ? inGroup.filter((f) => !f.isStarred) : inGroup
  /** 設計の「本名」。友だち情報欄に同じ名前の項目があればそれを使う。 */
  const realName = fields.find((f) => f.name === '本名')?.value ?? ''

  /** 見出しの下に1行で出す素性。設計は「本名 ・ 追加 ・ 流入元 ・ ID」の並び。 */
  const metaLine = [
    realName ? `本名 ${realName}` : null,
    friend?.createdAt
      ? `追加 ${new Date(friend.createdAt).toLocaleDateString('ja-JP')}`
      : null,
    friend?.firstTrackedLinkName ? `流入元 ${friend.firstTrackedLinkName}` : null,
    friend?.lineUserId ? `${friend.lineUserId.slice(0, 6)}…` : null,
  ]
    .filter(Boolean)
    .join(' ・ ')

  return (
    <div data-friends-detail-design="v4">
      <nav className="text-ink-faint mb-2 text-xs" data-design="Crumb">
        <Link href="/friends" className="hover:underline">
          友だち
        </Link>
        <span className="mx-1.5">/</span>
        <span>{friend?.displayName ?? '詳細'}</span>
      </nav>

      <div data-design="Head">
        <Header
          title={friend?.displayName ?? '友だち詳細'}
          description={metaLine || undefined}
          action={
            <div className="flex flex-wrap gap-2">
              {/* 一覧から隠す・LINE側でブロックする、どちらも受け口が無い。 */}
              <button
                disabled
                title="一覧から隠す操作は準備中です"
                className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
              >
                非表示
              </button>
              <button
                disabled
                title="ブロックはLINE側の操作です。管理画面からは変えられません"
                className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
              >
                ブロック
              </button>
              <Link
                href={`/chats?friendId=${friendId}`}
                className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors"
              >
                個別トークを開く
              </Link>
            </div>
          }
        />
      </div>

      {/*
        情報欄のグループ（設計の上段タブ）。「基本」＋フォルダ。
        右端は分類そのものを直す場所への行き先。
      */}
      <div className="border-hairline mb-4 flex flex-wrap items-center gap-1 border-b">
        {[{ id: BASIC_GROUP, name: '基本' }, ...groups].map((g) => (
          <Link
            key={g.id}
            href={`/friends/detail?id=${friendId}${g.id === BASIC_GROUP ? '' : `&group=${g.id}`}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              group === g.id
                ? 'border-accent text-accent'
                : 'text-ink-secondary hover:text-ink border-transparent'
            }`}
          >
            {g.name}
          </Link>
        ))}
        <Link
          href="/tags?tab=fields"
          className="text-ink-secondary hover:text-ink ml-auto px-3 py-2 text-xs"
        >
          タブを編集（友だち情報欄）
        </Link>
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[20rem_1fr]">
          {/* 左：プロフィール（設計の並び：マイル → 対応 → 名前 → タグ →
              ★つき友だち情報 → リッチメニュー → 友だち情報 → フォーム回答） */}
          <aside data-design="Left" className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <div className="border-hairline border-b px-5 py-3.5">
              <h2 className="text-ink text-sm font-semibold">友だち詳細</h2>
            </div>

            {/*
              マイル。設計ではここだけ地を黒く反転している。ほかの節と
              同じ白地にすると、残高が並の情報に見える。
            */}
            <div className="bg-ink px-5 py-4">
              <p className="text-xs text-white/60">マイル</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-white">
                {mileage ? mileage.available.toLocaleString('ja-JP') : '—'}
                <span className="ml-1 text-xs font-normal text-white/60">mile</span>
              </p>
              <p className="text-xs text-white/60">
                利用可能
                {mileage && mileage.pending > 0
                  ? ` ・ 確定待ち ${mileage.pending.toLocaleString('ja-JP')}`
                  : ''}
              </p>
            </div>

            <div className="space-y-4 p-5">
              {/* ---- 対応 ---- */}
              <div>
                <SectionHead
                  label="対応"
                  actionLabel="編集"
                  href={`/chats?friendId=${friendId}`}
                />
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">対応状況</dt>
                    <dd>
                      <SupportMarkBadge status={friend?.support?.status} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">担当者</dt>
                    <dd className="text-ink-secondary truncate">
                      {friend?.support?.operatorName ?? '未割り当て'}
                    </dd>
                  </div>
                </dl>
                <p className="text-ink-faint mt-2 mb-1 text-xs">個別メモ</p>
                {/* 書き換えは受信箱側が持っている。ここは読むだけ。 */}
                <p className="border-hairline bg-canvas-sunken text-ink-secondary rounded-control min-h-[3.5rem] border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
                  {friend?.support?.notes || 'メモはありません'}
                </p>
              </div>

              {/* ---- 名前 ---- */}
              <div>
                <SectionHead label="名前" actionLabel="編集" href={`/chats?friendId=${friendId}`} />
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">本名</dt>
                    <dd className="text-ink-secondary truncate">{realName || '未登録'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">システム表示名</dt>
                    <dd className="text-ink-secondary truncate">{friend?.displayName ?? '未登録'}</dd>
                  </div>
                </dl>
              </div>

              {/* ---- タグ ---- */}
              {/* 設計では名前の下。以前はいちばん上にあり、名前より先に
                  タグが目に入っていた。 */}
              <div>
                <SectionHead label="タグ" actionLabel="編集" href={`/chats?friendId=${friendId}`} />
                <div className="flex flex-wrap items-center gap-1">
                  {friend?.tags?.length ? (
                    friend.tags.map((t) => <TagBadge key={t.id} tag={t} />)
                  ) : (
                    <span className="text-ink-faint text-xs">タグはありません</span>
                  )}
                  <Link
                    href={`/chats?friendId=${friendId}`}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-pill border px-2 py-0.5 text-[11px]"
                  >
                    ＋ 追加
                  </Link>
                </div>
              </div>

              {/* ---- ★つき友だち情報 ---- */}
              {starred.length > 0 && (
                <div>
                  <SectionHead
                    label="★つき友だち情報"
                    actionLabel="すべて見る"
                    href={`/friends/detail?id=${friendId}&tab=info`}
                  />
                  <dl className="space-y-1 text-xs">
                    {starred.map((f) => (
                      <div key={f.id} className="flex justify-between gap-2">
                        <dt className="text-ink-faint shrink-0">{f.name}</dt>
                        <dd className="text-ink-secondary truncate text-right">
                          {values[f.id] || '未入力'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {/* ---- リッチメニュー ---- */}
              <div>
                <SectionHead label="リッチメニュー" actionLabel="変更" href="/rich-menus" />
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">現在の設定</dt>
                    <dd className="text-ink-secondary truncate text-right">
                      {richMenu?.name ?? '既定のメニュー'}
                      {richMenu?.isDefault && (
                        <span className="text-ink-faint ml-1">（全員に出しているもの）</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* ---- 友だち情報 ---- */}
              <div>
                <p className="text-ink-faint mb-1.5 text-xs font-semibold">友だち情報</p>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">追加日</dt>
                    <dd className="text-ink-secondary">
                      {friend?.createdAt
                        ? new Date(friend.createdAt).toLocaleDateString('ja-JP')
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">流入元</dt>
                    <dd className="text-ink-secondary truncate">
                      {friend?.firstTrackedLinkName ?? '不明'}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* ---- フォーム回答 ---- */}
              <div>
                <SectionHead
                  label="フォーム回答"
                  actionLabel="すべて見る"
                  href={`/friends/detail?id=${friendId}&tab=forms`}
                />
                <p className="text-ink-secondary text-xs">
                  {friend?.formSubmissions?.length
                    ? `${friend.formSubmissions.length}件`
                    : '回答はまだありません'}
                </p>
              </div>
            </div>
          </aside>

          {/* 右：タブ */}
          <div data-design="Right">
            <div className="border-hairline mb-4 flex flex-wrap gap-1 border-b">
              {TABS.map((t) => (
                <Link
                  key={t.key}
                  href={`/friends/detail?id=${friendId}&tab=${t.key}${
                    group === BASIC_GROUP ? '' : `&group=${group}`
                  }`}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                    tab === t.key
                      ? 'border-accent text-accent'
                      : 'text-ink-secondary hover:text-ink border-transparent'
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </div>

            {tab === 'timeline' && <FriendTimeline friendId={friendId} />}

            {/* 出す先のデータを取る口が無いもの。何が足りないかを書く。 */}
            {TABS.map((t) =>
              'pending' in t && t.pending && tab === t.key ? (
                <div
                  key={t.key}
                  className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm"
                >
                  {t.pending}
                </div>
              ) : null,
            )}

            {tab === 'info' && (
              <div className="bg-canvas rounded-card border-hairline border p-5">
                {inGroup.length === 0 ? (
                  <p className="text-ink-faint py-6 text-center text-sm">
                    {group === BASIC_GROUP
                      ? '情報欄の項目がまだありません。'
                      : 'この分類の項目はまだありません。'}
                    <Link
                      href={`/tags/fields/new?back=/friends/detail?id=${friendId}`}
                      className="text-accent ml-1 hover:underline"
                    >
                      項目を追加
                    </Link>
                  </p>
                ) : (
                  <>
                    {[...groupStarred, ...rest].map((field) => (
                      <div key={field.id} className="mb-4">
                        <label className="text-ink-secondary mb-1 block text-sm font-medium">
                          {field.isStarred && <span className="text-warning mr-1">★</span>}
                          {field.name}
                          <span className="text-ink-faint ml-1.5 text-xs font-normal">
                            {FIELD_TYPE_LABELS[field.type] ?? field.type}
                          </span>
                          {field.isPersonal && (
                            <span className="bg-warning-bg text-warning rounded-pill ml-1.5 px-1.5 py-0.5 text-[10px]">
                              個人情報
                            </span>
                          )}
                        </label>
                        <FieldInput
                          field={field}
                          value={values[field.id] ?? ''}
                          onChange={(v) => setValues((prev) => ({ ...prev, [field.id]: v }))}
                        />
                        {field.ecIsMaster && (
                          <p className="text-ink-faint mt-1 text-xs">
                            EC側の値が正のため、ここからは変更できません。
                          </p>
                        )}
                      </div>
                    ))}

                    {hiddenPersonalCount > 0 && (
                      <p className="text-ink-faint bg-canvas-sunken rounded-control mb-4 px-3 py-2 text-xs">
                        個人情報の項目が {hiddenPersonalCount} 件あります。
                        表示にはオーナーまたは管理者の権限が要ります。
                      </p>
                    )}

                    {warnings.length > 0 && (
                      <ul className="bg-warning-bg text-warning mb-3 space-y-1 rounded-lg p-3 text-xs">
                        {warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    )}
                    {notice && <p className="text-success mb-3 text-sm">{notice}</p>}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={save}
                        disabled={saving}
                        className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
                      >
                        {saving ? '保存中...' : '保存'}
                      </button>
                      <Link
                        href={`/tags/fields/new?back=/friends/detail?id=${friendId}`}
                        className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium"
                      >
                        項目を追加
                      </Link>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'forms' && (
              <div className="bg-canvas rounded-card border-hairline border p-5">
                {!friend?.formSubmissions || friend.formSubmissions.length === 0 ? (
                  <p className="text-ink-faint py-6 text-center text-sm">
                    フォームの回答はまだありません。
                  </p>
                ) : (
                  <ul className="divide-hairline divide-y">
                    {friend.formSubmissions.map((s) => (
                      <li key={s.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-ink text-sm font-medium">{s.formName}</p>
                          <p className="text-ink-faint text-xs">
                            {new Date(s.createdAt).toLocaleString('ja-JP')}
                          </p>
                        </div>
                        <dl className="mt-1.5 space-y-0.5">
                          {Object.entries(s.data ?? {}).map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-xs">
                              <dt className="text-ink-faint shrink-0">{k}</dt>
                              <dd className="text-ink-secondary break-all">
                                {Array.isArray(v) ? v.join(', ') : String(v ?? '')}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function FriendDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <FriendDetailInner />
    </Suspense>
  )
}
