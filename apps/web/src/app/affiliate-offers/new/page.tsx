'use client'

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
 * 案件を作る（設計 V2 6-1-3）。
 *
 * 設計は「どの案件か → いくら払うか → 自動で行うこと」の順。
 * タグとシナリオは**成果が確定したときに実行するもの**で、成果の条件ではない。
 * ここを取り違えると、紹介の成果がいつまでも確定しない設定ができてしまう。
 */
export default function NewAffiliateOfferPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rewardAmount, setRewardAmount] = useState('')
  const [rewardMiles, setRewardMiles] = useState('')
  const [lineAccountId, setLineAccountId] = useState('')
  const [tagId, setTagId] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [publishNow, setPublishNow] = useState(true)
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
          setAccounts(a.value.data as unknown as LineAccount[])
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
      saveLabel="案件を作成"
      validate={() => {
        if (!name.trim()) return '案件名を入力してください'
        if (!rewardAmount && !rewardMiles) return '報酬（円かマイル）のどちらかを入れてください'
        return null
      }}
      onReset={() => {
        setName('')
        setDescription('')
      }}
      onSave={async () => {
        const res = await api.affiliateOffers.create({
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: rewardAmount ? Number(rewardAmount) : undefined,
          rewardMiles: rewardMiles ? Number(rewardMiles) : undefined,
          lineAccountId: lineAccountId || null,
          tagId: tagId || null,
          scenarioId: scenarioId || null,
        })
        if (!res.success) throw new Error('案件を作成できませんでした')
        // 作成は必ず公開中で入る（DB の INSERT が is_active=1 固定）。
        // 下書きにしたいときだけ、続けて閉じる。
        if (!publishNow) {
          await api.affiliateOffers.update(res.data.id, { isActive: false })
        }
        return res.data.id
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
              <p className="bg-accent-deep text-on-accent rounded-control mt-3 px-3 py-2 text-center text-xs font-medium">
                この案件を紹介する
              </p>
            </div>
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
      <FormSection step={1} label="どの案件か">
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

        <Field
          label="対象アカウント"
          htmlFor="of-account"
          note="1つに絞ると、そのアカウントで起きた成果だけを数えます。"
        >
          <select
            id="of-account"
            value={lineAccountId}
            onChange={(e) => setLineAccountId(e.target.value)}
            className={inputClass}
          >
            <option value="">すべてのアカウント</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
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
      </FormSection>

      <FormSection step={2} label="いくら払うか" note="現金とマイルは併用できます。">
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
          htmlFor="of-program"
          note="マイルで払う場合に選びます。いまは標準プログラムのみです。"
        >
          <select id="of-program" disabled className={`${inputClass} opacity-50`}>
            <option>標準プログラム</option>
          </select>
        </Field>
      </FormSection>

      <FormSection
        step={3}
        label="自動で行うこと"
        note="成果が確定したタイミングで実行されます。"
      >
        <Field label="付けるタグ" htmlFor="of-tag" note="あとで配信の絞り込みに使えます。">
          <select
            id="of-tag"
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            className={inputClass}
          >
            <option value="">（なし）</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="開始するシナリオ"
          htmlFor="of-scenario"
          note="選ばなければ何も送りません。"
        >
          <select
            id="of-scenario"
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)}
            className={inputClass}
          >
            <option value="">（なし）</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

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
