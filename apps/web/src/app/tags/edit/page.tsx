'use client'

import SelectField from '@/components/shared/select-field'
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import { Field, inputClass } from '@/components/shared/create-page'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import EditTagPageV4 from '@/components/friend-fields/edit-tag-page-v4'
import Breadcrumb from '@/components/layout/breadcrumb'

/**
 * タグを編集する。
 *
 * 一覧の表からマイルの列（獲得・紹介者・倍率・優先度）を外した。設計の
 * 一覧にはこの4列が無く、代わりに「タグを作る」画面の中に倍率がある。
 * ただし外すだけだと、既にあるタグの倍率を変える場所が消える。
 * 作る画面と同じ形の編集画面をここに置いて、そちらへ移した。
 *
 * ルートが /tags/[id] ではなく /tags/edit?id= なのは、この管理画面が
 * 静的書き出しだから。ほかの編集画面と同じ形。
 */

/**
 * 倍率の選択肢。内部は bps（10000 = 1.0倍）で持つ。
 *
 * 自由入力にすると 1.05 倍のような刻みが作れてしまい、あとから
 * 「なぜこの人だけ端数が付くのか」を追えなくなる。決まった段だけ出す。
 */
const MULTIPLIERS = [
  { value: '', label: 'かけない（1.0倍）' },
  { value: '12000', label: '1.2倍' },
  { value: '15000', label: '1.5倍' },
  { value: '20000', label: '2.0倍' },
  { value: '30000', label: '3.0倍' },
]

function EditTagInner() {
  const router = useRouter()
  const params = useSearchParams()
  const tagId = params.get('id') ?? ''

  const [tag, setTag] = useState<Tag | null>(null)
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState('')

  /**
   * 見た目に使う色。**タグ自身は色を持たない。**
   * 選んだ分類（フォルダ）の色を出す。決めていなければ灰色。
   */
  const previewColor = groups.find((g) => g.id === groupId)?.color ?? '#8b938d'
  const [reward, setReward] = useState('0')
  const [referralReward, setReferralReward] = useState('0')
  const [multiplier, setMultiplier] = useState('')
  const [priority, setPriority] = useState('0')
  const [isStarred, setIsStarred] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [applyToExisting, setApplyToExisting] = useState(false)
  const [retroactiveConfirmOpen, setRetroactiveConfirmOpen] = useState(false)

  const load = useCallback(async () => {
    if (!tagId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [tagsRes, groupsRes] = await Promise.all([
        api.tags.list({ withCounts: true }),
        api.tagGroups.list().catch(() => null),
      ])
      if (groupsRes?.success) setGroups(groupsRes.data)
      if (tagsRes.success) {
        const found = tagsRes.data.find((t) => t.id === tagId) ?? null
        setTag(found)
        if (found) {
          setName(found.name)
          setGroupId(found.groupId ?? '')
          setReward(String(found.mileageReward ?? 0))
          setReferralReward(String(found.referralMileageReward ?? 0))
          setMultiplier(found.mileageMultiplierBps == null ? '' : String(found.mileageMultiplierBps))
          setPriority(String(found.mileageMultiplierPriority ?? 0))
          setIsStarred(found.isStarred ?? false)
          setApplyToExisting(false)
        }
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [tagId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (confirmedRetroactive = false) => {
    if (saving) return
    if (!name.trim()) {
      setError('タグ名を入力してください')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      // 名前と所属、マイルで受け口が分かれている。順に当てる。
      // 色は送らない。印の色はフォルダに付いていて、タグ側は持たない。
      await api.tags.update(tagId, { name: name.trim(), isStarred })
      if ((tag?.groupId ?? '') !== groupId) {
        await api.tags.setGroup(tagId, groupId || null)
      }
      const res = await api.tags.updateMileage(tagId, {
        rewardMiles: Number(reward) || 0,
        referralRewardMiles: Number(referralReward) || 0,
        multiplierBps: multiplier === '' ? null : Number(multiplier),
        multiplierPriority: Number(priority) || 0,
        applyToExisting: confirmedRetroactive && applyToExisting,
      })
      if (!res.success) throw new Error(res.error)
      // 付与が積まれたときだけ件数を出す。0件のときに出すと、
      // 何かが起きたように読める。
      setNotice(
        res.data.queued > 0
          ? `保存しました。${res.data.queued} 人にマイルを積みました`
          : '保存しました',
      )
      setApplyToExisting(false)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const requestSave = () => {
    const needsConfirmation =
      applyToExisting &&
      (tag?.friendCount ?? 0) > 0 &&
      (Number(reward) > 0 || Number(referralReward) > 0)
    if (needsConfirmation) {
      setRetroactiveConfirmOpen(true)
      return
    }
    void save(false)
  }

  if (!tagId) {
    return (
      <div>
        <Header title="タグを編集" />
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          タグが指定されていません。
          <Link href="/tags" className="text-accent ml-1 hover:underline">
            友だち属性へ戻る
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <Breadcrumb items={[
        { label: '友だち', href: '/friends' },
        { label: '友だち属性', href: '/tags' },
        { label: 'タグ編集' },
      ]} />

      <Header
        title="タグを編集"
        description="名前・分類と、タグが付いた時のマイル連動を変更できます。"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/tags')}
              className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-4 py-2 text-sm font-medium"
            >
              キャンセル
            </button>
            <button
              onClick={requestSave}
              disabled={saving || loading}
              className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        }
      />

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger rounded-card mb-4 border p-4 text-sm">
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-success-bg text-success rounded-card mb-4 p-4 text-sm">{notice}</div>
      )}

      {loading ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          読み込み中...
        </p>
      ) : !tag ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          このタグは見つかりませんでした。
          <Link href="/tags" className="text-accent ml-1 hover:underline">
            一覧へ戻る
          </Link>
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-5">
            <section className="bg-canvas rounded-card border-hairline border p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
              <p className="text-ink mb-4 text-sm font-semibold">1. どのタグか</p>

              <Field label="タグ名" htmlFor="tag-name" required>
                <input
                  id="tag-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </Field>
              {/*
                色の選択は外した。色はフォルダ（分類）に付く。タグ1つずつに
                色を決めさせると、100枚あるタグで色がばらけて一覧での区別に
                使えない。下の「所属グループ」で決めた分類の色が出る。
              */}

              <Field
                label="所属グループ"
                htmlFor="tag-group"
                note="どの分類に入れるかを選びます。未選択なら「未分類」になります。"
              >
                <SelectField
                  id="tag-group"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  options={[{ value: '', label: '未分類' }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
                />
              </Field>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
              <p className="text-ink mb-1 text-sm font-semibold">2. 自動で付ける条件</p>
              {/* きっかけはタグ側ではなく、回答フォームやオートメーション側に置かれている。 */}
              <p className="text-ink-faint text-xs leading-relaxed">
                いまは手動でのみ付けられます。フォームの回答や購入をきっかけに付けたい場合は、回答フォームやオートメーションの設定から指定してください。
              </p>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
              <p className="text-ink mb-1 text-sm font-semibold">3. マイル連動</p>
              <p className="text-ink-faint mb-4 text-xs leading-relaxed">
                このタグを持つ人のマイル付与に倍率をかけられます。
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="倍率" htmlFor="tag-multiplier">
                  <SelectField
                    id="tag-multiplier"
                    value={multiplier}
                    onChange={(e) => setMultiplier(e.target.value)}
                    options={MULTIPLIERS.map((m) => ({ value: m.value, label: m.label }))}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="優先度"
                  htmlFor="tag-priority"
                  note="複数のタグを持つ場合、いちばん高いもの1枚だけが効きます。"
                >
                  <SelectField
                    id="tag-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    aria-label="タグの優先度"
                    className={inputClass}
                    options={[0, 1, 2, 3, 4, 5].map((priorityValue) => ({
                      value: String(priorityValue),
                      label: String(priorityValue),
                    }))}
                  />
                </Field>
              </div>

              <div className="border-hairline mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2">
                <Field
                  label="本人へ付与するマイル"
                  htmlFor="tag-reward"
                  note="このタグが初めて付いたときに一度だけ積みます。"
                >
                  <input
                    id="tag-reward"
                    type="number"
                    min={0}
                    value={reward}
                    onChange={(e) => setReward(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="紹介者へ付与するマイル"
                  htmlFor="tag-referral"
                  note="紹介された人にこのタグが付いたとき、紹介者へ積みます。"
                >
                  <input
                    id="tag-referral"
                    type="number"
                    min={0}
                    value={referralReward}
                    onChange={(e) => setReferralReward(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>

              <label className="border-warning/30 bg-warning-bg rounded-control mt-4 flex cursor-pointer items-start gap-3 border p-3">
                <input
                  type="checkbox"
                  checked={applyToExisting}
                  onChange={(e) => setApplyToExisting(e.target.checked)}
                  className="accent-accent mt-0.5"
                />
                <span className="text-ink-secondary text-sm">
                  すでにこのタグが付いている人にも遡って付与する
                  <span className="text-ink-faint block text-xs leading-relaxed">
                    対象は {(tag.friendCount ?? 0).toLocaleString('ja-JP')} 人です。通常の保存では既存ユーザーへ付与しません。
                  </span>
                </span>
              </label>

              <label className="border-hairline rounded-control mt-4 flex cursor-pointer items-start gap-3 border p-3">
                <input
                  type="checkbox"
                  checked={isStarred}
                  onChange={(e) => setIsStarred(e.target.checked)}
                  className="accent-accent mt-0.5"
                />
                <span className="text-ink-secondary text-sm">
                  友だち一覧に表示する
                  <span className="text-ink-faint block text-xs">
                    ★を付けると、友だち一覧の「★つきタグ」列に出ます。
                  </span>
                </span>
              </label>
            </section>
          </div>

          {/* 右：できあがるタグ */}
          <aside className="space-y-4">
            <section className="bg-canvas rounded-card border-hairline border p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
              <p className="text-ink mb-3 text-sm font-semibold">できあがるタグ</p>
              <span
                className="rounded-pill inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium"
                // 見た目の色は、選んだ分類（フォルダ）の色。分類を決めて
                // いない・色を付けていない分類なら灰色になる。
                style={{ backgroundColor: `${previewColor}1a`, color: previewColor }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: previewColor }} />
                {name || 'タグ名'}
              </span>
              <p className="text-ink-faint mt-3 text-xs leading-relaxed">
                このタグは、配信の絞り込み・シナリオの開始条件・自動応答の付与先として使えます。
              </p>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
              <p className="text-ink mb-1 text-sm font-semibold">いま付いている人</p>
              <p className="text-ink text-xl font-bold tabular-nums">
                {(tag.friendCount ?? 0).toLocaleString('ja-JP')}
                <span className="text-ink-faint ml-1 text-xs font-normal">人</span>
              </p>
              <p className="text-ink-faint mt-2 text-xs leading-relaxed">
                通常の保存では、すでに付いている人へマイルを積み直しません。遡及する場合だけ左の項目を選びます。
              </p>
            </section>
          </aside>
        </div>
      )}
      <ConfirmDialog
        open={retroactiveConfirmOpen}
        title="既存の友だちへマイルを遡及しますか？"
        description={`このタグが付いている ${(tag?.friendCount ?? 0).toLocaleString('ja-JP')} 人を対象に、未付与分をキューへ登録します。通常の保存より影響が大きい操作です。`}
        confirmLabel="遡及して保存"
        destructive
        onCancel={() => setRetroactiveConfirmOpen(false)}
        onConfirm={() => {
          setRetroactiveConfirmOpen(false)
          void save(true)
        }}
      />
    </div>
  )
}

function LegacyEditTagPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <EditTagInner />
    </Suspense>
  )
}

void LegacyEditTagPage

export default function EditTagPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}>
      <EditTagPageV4 />
    </Suspense>
  )
}
