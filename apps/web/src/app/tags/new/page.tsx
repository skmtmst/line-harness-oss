'use client'

import SelectField from '@/components/shared/select-field'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import type { TagGroup } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'
import NewTagPageV4 from '@/components/friend-fields/new-tag-page-v4'

/**
 * 倍率の選択肢。内部は bps（10000 = 1.0倍）で持つ。
 * 編集画面（/tags/edit）と同じ段にそろえる。
 */
const MULTIPLIERS = [
  { value: '', label: 'かけない（1.0倍）' },
  { value: '12000', label: '1.2倍' },
  { value: '15000', label: '1.5倍' },
  { value: '20000', label: '2.0倍' },
  { value: '30000', label: '3.0倍' },
]

function LegacyNewTagPage() {
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState('')

  const [groups, setGroups] = useState<TagGroup[]>([])
  const [reward, setReward] = useState('0')
  const [referralReward, setReferralReward] = useState('0')
  const [multiplier, setMultiplier] = useState('')
  const [priority, setPriority] = useState('0')
  const [isStarred, setIsStarred] = useState(false)

  /**
   * 見た目に使う色。**タグ自身は色を持たない。**
   * 選んだ分類（フォルダ）の色を出す。決めていなければ灰色。
   */
  const previewColor = groups.find((g) => g.id === groupId)?.color ?? '#8b938d'


  useEffect(() => {
    void api.tagGroups.list().then((res) => {
      if (res.success) setGroups(res.data)
    })
  }, [])

  const groupName = groups.find((g) => g.id === groupId)?.name ?? '未分類'

  return (
    <CreatePage
      title="タグを作る"
      description="友だちを分類するタグを作ります。グループは「お悩み」「ペット」などの分類、タグはその中身です。"
      parent={['タグ管理', '/tags']}
      saveLabel="タグを作る"
      validate={() => {
        if (!name.trim()) return 'タグ名を入力してください'
        if (!Number.isInteger(Number(reward)) || Number(reward) < 0) {
          return '本人へ付与するマイルは0以上の整数で入力してください'
        }
        if (!Number.isInteger(Number(referralReward)) || Number(referralReward) < 0) {
          return '紹介者へ付与するマイルは0以上の整数で入力してください'
        }
        return null
      }}
      onReset={() => {
        setName('')
        setGroupId('')
        setReward('0')
        setReferralReward('0')
        setMultiplier('')
        setPriority('0')
        setIsStarred(false)
      }}
      onSave={async () => {
        // 色は送らない。印の色はフォルダに付いていて、タグ側は持たない。
        const res = await api.tags.create({
          name: name.trim(),
          groupId: groupId || null,
        })
        if (!res.success) throw new Error(res.error)
        // 一覧に出す印も作成の受け口に無い。倍率と一緒にあとで当てる。
        if (isStarred) {
          await api.tags.update(res.data.id, { isStarred: true })
        }
        // マイル設定は作成の受け口に無い。作った直後に安全に当てる。
        // 新規タグなので既存の付与済み友だちはおらず、遡及処理は不要。
        if (
          Number(reward) > 0 ||
          Number(referralReward) > 0 ||
          multiplier !== '' ||
          priority !== '0'
        ) {
          await api.tags.updateMileage(res.data.id, {
            rewardMiles: Number(reward) || 0,
            referralRewardMiles: Number(referralReward) || 0,
            multiplierBps: multiplier === '' ? null : Number(multiplier),
            multiplierPriority: Number(priority) || 0,
            applyToExisting: false,
          })
        }
        return res.data.id
      }}
      aside={
        <div className="space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
            <p className="text-ink mb-3 text-sm font-semibold">できあがるタグ</p>
            <div className="flex items-center gap-2">
              <span
                className="rounded-pill inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium"
                // 見た目の色は、選んだ分類（フォルダ）の色。分類を決めて
                // いない・色を付けていない分類なら灰色になる。
                style={{ backgroundColor: `${previewColor}1a`, color: previewColor }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: previewColor }} />
                {name || 'タグ名'}
              </span>
              <span className="text-ink-faint text-xs">{groupName}</span>
            </div>
            <p className="text-ink-faint mt-3 text-xs leading-relaxed">
              このタグは、配信の絞り込み・シナリオの開始条件・自動応答の付与先として使えます。
            </p>
            {(Number(reward) > 0 || Number(referralReward) > 0 || multiplier !== '') && (
              <dl className="border-hairline mt-4 space-y-2 border-t pt-3 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">本人への初回付与</dt>
                  <dd className="text-ink font-semibold">{Number(reward).toLocaleString('ja-JP')} mile</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">紹介者への付与</dt>
                  <dd className="text-ink font-semibold">{Number(referralReward).toLocaleString('ja-JP')} mile</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">以後の倍率</dt>
                  <dd className="text-ink font-semibold">
                    {multiplier === '' ? '1.0倍' : `${Number(multiplier) / 10000}倍`}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <p className="text-ink text-sm font-semibold">グループを追加する</p>
              <Link href="/tags" className="text-accent shrink-0 text-xs hover:underline">
                ＋ 追加
              </Link>
            </div>
            <p className="text-ink-faint mb-3 text-xs leading-relaxed">
              タグ管理の左にあるフォルダの欄から、新しい分類を作れます。
            </p>
            <ul className="space-y-1.5">
              {groups.length === 0 ? (
                <li className="text-ink-faint text-xs">分類はまだありません</li>
              ) : (
                groups.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-ink-secondary truncate">{g.name}</span>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      }
    >
      <section className="border-hairline rounded-card border p-5">
        <p className="text-ink mb-4 text-sm font-semibold">1. どのタグか</p>

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

        <Field label="タグ名" htmlFor="tag-name" required>
          <input
            id="tag-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 関節"
            className={inputClass}
          />
        </Field>
              {/*
                色の選択は外した。色はフォルダ（分類）に付く。タグ1つずつに
                色を決めさせると、100枚あるタグで色がばらけて一覧での区別に
                使えない。下の「所属グループ」で決めた分類の色が出る。
              */}
      </section>

      <section className="border-hairline rounded-card border p-5">
        <p className="text-ink mb-1 text-sm font-semibold">2. 自動で付ける条件</p>
        <p className="text-ink-faint mb-4 text-xs leading-relaxed">
          指定しない場合は、手動でのみ付けられます。
        </p>
        {/*
          設計はここに「きっかけ・対象・条件」の3つを選ばせる。きっかけの
          仕組みは回答フォームとオートメーションの側にあって、タグから
          指定する受け口が無い。選べる形にすると、選んで保存したのに
          永久に付かないルールができる。行き先だけ示す。
        */}
        <div className="border-hairline rounded-control border p-4">
          <p className="text-ink-secondary text-sm font-medium">手動でのみ付ける</p>
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            一覧やチャットから手で付けます。フォームの回答や購入をきっかけに付けたい場合は、
            <Link href="/form-submissions" className="text-accent mx-1 hover:underline">
              回答フォーム
            </Link>
            か
            <Link href="/automations" className="text-accent mx-1 hover:underline">
              オートメーション
            </Link>
            の設定から指定してください。
          </p>
        </div>
      </section>

      <section className="border-hairline rounded-card border p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <p className="text-ink mb-1 text-sm font-semibold">3. マイル連動</p>
        <p className="text-ink-faint mb-4 text-xs leading-relaxed">
          タグが初めて付いた時のマイルと、タグを持っている間の倍率をまとめて設定します。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="本人へ付与するマイル"
            htmlFor="tag-reward"
            note="このタグが初めて付いた時に、本人へ1回だけ付与します。"
          >
            <input
              id="tag-reward"
              type="number"
              min={0}
              step={1}
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field
            label="紹介者へ付与するマイル"
            htmlFor="tag-referral-reward"
            note="紹介された人にこのタグが付いた時、紹介者へ1回だけ付与します。"
          >
            <input
              id="tag-referral-reward"
              type="number"
              min={0}
              step={1}
              value={referralReward}
              onChange={(e) => setReferralReward(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="border-hairline mt-4 border-t pt-4">
          <p className="text-ink mb-3 text-sm font-medium">タグを持っている間の倍率</p>
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
        </div>

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
    </CreatePage>
  )
}

void LegacyNewTagPage

export default function NewTagPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-ink-faint">読み込み中…</p>}>
      <NewTagPageV4 />
    </Suspense>
  )
}
