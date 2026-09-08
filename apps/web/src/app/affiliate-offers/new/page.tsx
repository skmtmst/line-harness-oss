'use client'

import SelectField from '@/components/shared/select-field'
import { useEffect, useState } from 'react'
import type { Tag, Scenario, LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, {
  AsideCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'

/**
 * 案件を作る（設計 V6 `GPWzq`）。
 *
 * 設計は「どの案件か → いくら払うか → 自動で行うこと」の順。
 * タグとシナリオは**成果が確定したときに実行するもの**で、成果の条件ではない。
 * ここを取り違えると、紹介の成果がいつまでも確定しない設定ができてしまう。
 */
function Unavailable({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="border-hairline rounded-control bg-canvas-sunken border px-3 py-2">
      <p className="text-ink-secondary text-label font-semibold">{label}</p>
      <p className="text-ink text-label">—</p>
      <p className="text-ink-faint text-micro mt-0.5">{reason}</p>
    </div>
  )
}

export default function NewAffiliateOfferPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rewardAmount, setRewardAmount] = useState('')
  const [rewardMiles, setRewardMiles] = useState('')
  const [lineAccountId, setLineAccountId] = useState('')
  const [tagId, setTagId] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [publishNow, setPublishNow] = useState(true)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [accounts, setAccounts] = useState<LineAccount[]>([])

  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([api.tags.list(), api.scenarios.list(), api.lineAccounts.list()]).then(
      ([t, s, a]) => {
        if (cancelled) return
        if (t.status === 'fulfilled' && t.value.success) setTags(t.value.data)
        if (s.status === 'fulfilled' && s.value.success) {
          setScenarios(s.value.data as unknown as Scenario[])
        }
        if (a.status === 'fulfilled' && a.value.success) {
          const list = a.value.data as unknown as LineAccount[]
          setAccounts(list)
          // 選べるアカウントが1つだけなら最初から選んでおく。
          // 空のまま押すと口が 400 で落とす（#505 重大1）。
          if (list.length === 1) setLineAccountId(list[0].id)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const yen = rewardAmount ? Number(rewardAmount) : 0
  const miles = rewardMiles ? Number(rewardMiles) : 0

  return (
    <CreatePage
      title="案件を作る"
      description="何を成果として数え、いくら払うかを決めます。"
      parent={['案件', '/conversions?tab=offers']}
      saveLabel={publishNow ? '公開する' : '下書きに保存'}
      variant="v6"
      designNode="GPWzq"
      validate={() => {
        if (!name.trim()) return '案件名を入力してください'
        // 「すべてのアカウント」のまま送ると口が 400 で落とす。
        // 選べる先が複数あるときは、押す前に選ばせる（#505 重大1）。
        if (!lineAccountId && accounts.length > 1) return 'LINEアカウントを選んでください'
        if (!rewardAmount && !rewardMiles) return '報酬（円かマイル）のどちらかを入れてください'
        if (rewardAmount && (!Number.isFinite(Number(rewardAmount)) || Number(rewardAmount) < 0)) {
          return '報酬額は0円以上で入力してください'
        }
        if (rewardMiles && (!Number.isFinite(Number(rewardMiles)) || Number(rewardMiles) < 0)) {
          return '報酬マイルは0以上で入力してください'
        }
        return null
      }}
      onReset={() => {
        setName('')
        setDescription('')
        setRewardAmount('')
        setRewardMiles('')
        setLineAccountId('')
        setTagId('')
        setScenarioId('')
        setPublishNow(true)
        setCreatedId(null)
      }}
      onSave={async () => {
        let offerId = createdId
        if (!offerId) {
          const res = await api.affiliateOffers.create({
            name: name.trim(),
            description: description.trim() || null,
            rewardAmount: rewardAmount ? Number(rewardAmount) : undefined,
            rewardMiles: rewardMiles ? Number(rewardMiles) : undefined,
            lineAccountId: lineAccountId || null,
            tagId: tagId || null,
            scenarioId: scenarioId || null,
          })
          if (!res.success) throw new Error('案件を作成できませんでした。LINEアカウントを選び直してください')
          offerId = res.data.id
          setCreatedId(offerId)
        }
        // 作成は必ず公開中で入る（DB の INSERT が is_active=1 固定）。
        // 下書きにしたいときだけ、続けて閉じる。
        if (!publishNow) {
          const update = await api.affiliateOffers.update(offerId, { isActive: false })
          if (!update.success) {
            throw new Error('案件は作成済みですが、下書きにできませんでした。もう一度押すと下書きへの変更だけをやり直します。')
          }
        }
        return offerId
      }}
      aside={
        <>
          <AsideCard title="アフィリエイターの画面での見え方" note="プレビュー">
            <div className="bg-canvas-sunken rounded-card p-3">
              <p className="text-ink text-sm font-semibold">{name || '（案件名）'}</p>
              {description && (
                <p className="text-ink-faint mt-1 text-xs leading-relaxed">{description}</p>
              )}
              <p className="text-ink mt-2 text-sm font-semibold tabular-nums">
                ¥{yen.toLocaleString()}
                {miles > 0 && (
                  <span className="text-ink-secondary ml-1 text-xs">
                    ＋ {miles.toLocaleString()}マイル
                  </span>
                )}
              </p>
              <p className="text-ink-faint mt-2 truncate text-xs">
                紹介リンクは公開後に発行されます
              </p>
              {miles > 0 && (
                <p className="text-ink-faint mt-1 text-xs">
                  成果が認められると {miles.toLocaleString()} マイルも付与します
                </p>
              )}
              <p className="bg-accent-deep text-on-accent rounded-control mt-3 px-3 py-2 text-center text-xs font-medium">
                この案件を紹介する
              </p>
            </div>
          </AsideCard>

          <AsideCard title="つながる先">
            <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
              <li>・コンバージョン：何を成果として数えるか</li>
              <li>・マイル：成果で付けるマイル</li>
              <li>・流入と計測：経路ごとの成果</li>
              <li>・分析：案件ごとの成果と報酬</li>
            </ul>
          </AsideCard>

          <AsideCard title="気をつけること">
            <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
              <li>・公開したあとに報酬額を下げると、すでに発生した成果には影響しません</li>
              <li>・対象アカウントを変えると、それまでの成果の集計は残ります</li>
              <li>・下書きのままでは、アフィリエイターの画面に出ません</li>
            </ul>
          </AsideCard>
        </>
      }
    >
      <FormSection step={1} label="どんな案件か">
        <div className="grid gap-3 lg:grid-cols-2">
        <Field label="案件名" htmlFor="of-name" required>
          <input
            id="of-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：定期便の初回申込"
            className={inputClass}
          />
        </Field>
        <Field label="説明" htmlFor="of-desc" note="紹介する人に見せる説明です。">
          <textarea
            id="of-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例：初回の定期便をお申し込みいただいた方が対象です。"
            className={`${inputClass} resize-y`}
          />
        </Field>
        </div>
      </FormSection>

      <FormSection
        step={2}
        label="何をもって成果とするか"
        note="成果地点はコンバージョンで作成・管理します。"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Unavailable
            label="成果地点"
            reason="まだ繋がっていません。案件と成果地点の紐づけAPIが接続されると選べます。"
          />
          <Unavailable
            label="紹介とみなす期間"
            reason="まだ繋がっていません。成果を数える期間が接続されると表示されます（例：友だち追加から30日以内）。"
          />
          <Unavailable label="同じ友だちを数える回数" reason="まだ繋がっていません。二重計上を防ぐ設定が接続されると表示されます。" />
          <Unavailable label="成果の自動承認" reason="まだ繋がっていません。確認不要の条件が接続されると表示されます。" />
        </div>
      </FormSection>

      <FormSection step={3} label="いくら払うか" note="現金とマイルは併用できます。">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="報酬額（円）" htmlFor="of-amount">
            <input
              id="of-amount"
              type="number"
              min={0}
              value={rewardAmount}
              onChange={(e) => setRewardAmount(e.target.value)}
              placeholder="1000"
              className={`${inputClass} tabular-nums`}
            />
          </Field>
          <Field label="報酬マイル" htmlFor="of-miles" note="マイルで払う場合に入力します。">
            <input
              id="of-miles"
              type="number"
              min={0}
              value={rewardMiles}
              onChange={(e) => setRewardMiles(e.target.value)}
              placeholder="200"
              className={`${inputClass} tabular-nums`}
            />
          </Field>
        </div>

        {/* マイルのプログラムは作成時に選べない。API が受け取らず、DB は
            'default' で入る。選べる形にすると、選べないものが選べて見える。 */}
        <Field
          label="マイルのプログラム"
          note="マイルで払う場合に選びます。いまは標準プログラムのみです。"
        >
          <p className="bg-canvas-sunken text-ink-faint rounded-control px-3 py-2 text-sm">
            標準プログラム
          </p>
        </Field>

        <Field label="誘導するLINEアカウント" htmlFor="of-account" note="紹介リンクを開いた方を、このアカウントへ案内します。">
          <SelectField
            id="of-account"
            value={lineAccountId}
            onChange={(e) => setLineAccountId(e.target.value)}
            options={accounts.length > 1
              // 複数あるときの空欄は「全部」ではなく「未選択」。
              // そのまま送ると口が 400 で落とすので、選ばせる文言にする。
              ? [{ value: '', label: '選んでください' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]
              : [...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
        </Field>
      </FormSection>

      <FormSection
        step={4}
        label="成果を認めたときにすること"
        note="成果が確定したタイミングで実行されます。"
      >
        <div className="grid gap-3 lg:grid-cols-2">
        <Field label="付けるタグ" htmlFor="of-tag" note="あとで配信の絞り込みに使えます。">
          <SelectField
            id="of-tag"
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            options={[{ value: '', label: '（なし）' }, ...tags.map((t) => ({ value: t.id, label: t.name }))]}
          />
        </Field>

        <Field
          label="開始するシナリオ"
          htmlFor="of-scenario"
          note="選ばなければ何も送りません。"
        >
          <SelectField
            id="of-scenario"
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)}
            options={[{ value: '', label: '（なし）' }, ...scenarios.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </Field>
        </div>

        <label className="text-ink-secondary flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={publishNow}
            onChange={(e) => setPublishNow(e.target.checked)}
          />
          <span>
            作成したらすぐ公開する
            <span className="text-ink-faint block text-xs">
              オフにすると下書きとして保存され、アフィリエイターに表示されません。
            </span>
          </span>
        </label>
      </FormSection>
    </CreatePage>
  )
}
