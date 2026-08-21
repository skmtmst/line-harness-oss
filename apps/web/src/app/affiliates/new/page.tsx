'use client'

import { useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, {
  AsideCard,
  ChoiceCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'

/**
 * アフィリエイターを追加する（設計 V2 6-1-4）。
 *
 * 設計は「どなたを登録するか → どう支払うか → そのほか → 渡すURL」の順。
 *
 * 紹介コードだけ、設計どおりにしていない。設計は必須の手入力だが、worker は
 * 推測されにくいコードを自動で作るのを既定にしている（`affiliates.ts` の
 * random-code path）。手で決めたコードは当てられるので、他人の紹介の成果を
 * 横取りできてしまう。空欄なら自動、入れたときだけその値、という形にした。
 */

type PayoutKind = 'per_conversion' | 'rate' | 'none'

const PAYOUT_KINDS: Array<{ value: PayoutKind; label: string; note: string }> = [
  { value: 'per_conversion', label: '成果1件ごとに定額', note: '1件あたりの金額を決めます' },
  { value: 'rate', label: '売上に対する割合', note: '注文金額の◯%を報酬にします' },
  { value: 'none', label: '報酬なし（計測のみ）', note: '成果の件数だけを記録します' },
]

export default function NewAffiliatePage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [payoutKind, setPayoutKind] = useState<PayoutKind>('per_conversion')
  const [commissionRate, setCommissionRate] = useState('')
  const [holdDays, setHoldDays] = useState('30')
  const [payoutCycle, setPayoutCycle] = useState('')
  const [lineAccountId, setLineAccountId] = useState('')
  const [notifyOnConversion, setNotifyOnConversion] = useState(true)
  const [startTracking, setStartTracking] = useState(true)
  const [accounts, setAccounts] = useState<LineAccount[]>([])

  useEffect(() => {
    let cancelled = false
    void api.lineAccounts
      .list()
      .then((res) => {
        if (!cancelled && res.success) setAccounts(res.data as unknown as LineAccount[])
      })
      .catch(() => {
        // アカウントが引けなくても、登録はできる。
      })
    return () => {
      cancelled = true
    }
  }, [])

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = code.trim() ? `${workerBase}/r/${code.trim()}` : null

  return (
    <CreatePage
      title="アフィリエイターを追加する"
      description="紹介してくれる方に専用のリンクを渡し、成果と報酬を記録します。"
      parent={['成果とアフィリエイト', '/conversions?tab=affiliates']}
      saveLabel="アフィリエイターを追加"
      validate={() => {
        if (!name.trim()) return '名前・屋号を入力してください'
        // worker の CODE_RE は英数字4文字以上。ハイフンは弾かれる。
        if (code.trim() && !/^[A-Za-z0-9]{4,}$/.test(code.trim())) {
          return '紹介コードは英数字4文字以上で入力してください'
        }
        if (payoutKind === 'rate' && !commissionRate.trim()) {
          return '売上に対する割合を入力してください'
        }
        return null
      }}
      onReset={() => {
        setName('')
        setEmail('')
        setCode('')
      }}
      onSave={async () => {
        const res = await api.affiliates.create({
          name: name.trim(),
          code: code.trim() || undefined,
          commissionRate:
            payoutKind === 'rate' && commissionRate.trim() ? Number(commissionRate) : undefined,
          issueInitialLink: true,
        })
        if (!res.success) throw new Error(res.error)
        // 連絡先・保留期間・支払いサイクル・通知・計測の開始は作成のAPIが
        // 受けないので、続けて更新する。1つの操作として見えるようにまとめる。
        await api.affiliates.update(res.data.id, {
          email: email.trim() || null,
          holdDays: holdDays.trim() ? Number(holdDays) : null,
          payoutCycle: payoutCycle.trim() || null,
          notifyOnConversion,
          isActive: startTracking,
        })
        return res.data.id
      }}
      aside={
        <>
          <AsideCard title="渡し方の例">
            <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
              <li>・ブログ記事や紹介ページに設置</li>
              <li>・SNSのプロフィール欄に掲載</li>
              <li>・メールマガジンの本文に記載</li>
            </ul>
          </AsideCard>

          <AsideCard title="気をつけること">
            <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
              <li>・紹介コードはあとから変更できません</li>
              <li>・同じ人が複数のリンクから来た場合、最後にクリックしたリンクの成果になります</li>
              <li>・保留期間中の成果は「未確定」として表示されます</li>
            </ul>
          </AsideCard>
        </>
      }
    >
      <FormSection step={1} label="どなたを登録するか">
        <Field label="名前・屋号" htmlFor="af-name" required>
          <input
            id="af-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：ペットライフ編集部"
            className={inputClass}
          />
        </Field>

        <Field label="連絡先メール" htmlFor="af-email" note="報酬の確定連絡に使います。">
          <input
            id="af-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contact@example.com"
            className={inputClass}
          />
        </Field>

        <Field
          label="紹介コード"
          htmlFor="af-code"
          note="URLの末尾に使われます。英数字4文字以上。空欄にすると、推測されにくいコードを自動で作ります（そのほうが、他の人にコードを当てられて成果を横取りされる心配がありません）。"
        >
          <input
            id="af-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="petlife2026"
            className={inputClass}
          />
        </Field>
      </FormSection>

      <FormSection step={2} label="どう支払うか">
        <div className="grid gap-2 sm:grid-cols-3">
          {PAYOUT_KINDS.map((k) => (
            <ChoiceCard
              key={k.value}
              selected={payoutKind === k.value}
              title={k.label}
              note={k.note}
              onClick={() => setPayoutKind(k.value)}
            />
          ))}
        </div>

        {payoutKind === 'per_conversion' && (
          /* 1件あたりの金額はアフィリエイター側に列が無く、案件（offer）の
             報酬額で決まる。ここで入れられるように見せると、入れたのに
             効かない数字ができる。 */
          <Field label="1件あたりの報酬" note="金額は案件ごとに決めます。">
            <input
              disabled
              placeholder="案件の「報酬額」で決まります"
              className={`${inputClass} opacity-50`}
            />
          </Field>
        )}

        {payoutKind === 'rate' && (
          <Field label="売上に対する割合" htmlFor="af-rate">
            <div className="flex items-center gap-1.5">
              <input
                id="af-rate"
                type="number"
                min={0}
                step="0.1"
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)}
                placeholder="10"
                className={`${inputClass} w-28 tabular-nums`}
              />
              <span className="text-ink-faint text-sm">%</span>
            </div>
          </Field>
        )}

        {/* 何をもって成果とするかは案件（offer）側で決まる。ここに置くと、
            同じことを2か所で決められるように見える。 */}
        <Field label="成果として数えるもの" note="案件ごとに決めます。">
          <input
            disabled
            placeholder="案件の設定に従います"
            className={`${inputClass} opacity-50`}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="確定までの保留期間"
            htmlFor="af-hold"
            note="返品・キャンセルを考慮する期間です。"
          >
            <div className="flex items-center gap-1.5">
              <input
                id="af-hold"
                type="number"
                min={0}
                max={365}
                value={holdDays}
                onChange={(e) => setHoldDays(e.target.value)}
                className={`${inputClass} w-24 tabular-nums`}
              />
              <span className="text-ink-faint text-sm">日</span>
            </div>
          </Field>

          <Field label="支払いサイクル" htmlFor="af-cycle" note="取り決めの記録です。">
            <input
              id="af-cycle"
              type="text"
              value={payoutCycle}
              onChange={(e) => setPayoutCycle(e.target.value)}
              placeholder="例：月末締め翌月末払い"
              maxLength={100}
              className={inputClass}
            />
          </Field>
        </div>

        {/* アフィリエイターにアカウントを紐づける列が無い。案件側にはある。 */}
        <Field label="対象アカウント" htmlFor="af-account" note="案件ごとに決めます。">
          <select id="af-account" disabled value={lineAccountId} className={`${inputClass} opacity-50`}>
            <option value="">すべてのアカウント</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection step={3} label="そのほか">
        <label className="text-ink-secondary flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={notifyOnConversion}
            onChange={(e) => setNotifyOnConversion(e.target.checked)}
          />
          <span>
            成果が出たらメールで知らせる
            <span className="text-ink-faint block text-xs">
              報酬が確定したタイミングで本人に届きます。
            </span>
          </span>
        </label>

        <label className="text-ink-secondary flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={startTracking}
            onChange={(e) => setStartTracking(e.target.checked)}
          />
          <span>
            追加したらすぐ計測を始める
            <span className="text-ink-faint block text-xs">
              オフにするとリンクは発行されますが計測しません。
            </span>
          </span>
        </label>
      </FormSection>

      <FormSection step={4} label="この方に渡すURL" note="保存すると確定します。">
        <div className="border-hairline rounded-control flex items-center gap-2 border px-3 py-2">
          <code className="text-ink-secondary min-w-0 flex-1 truncate text-xs">
            {previewUrl ?? '保存したときに決まります'}
          </code>
          <button
            disabled
            title="保存すると押せるようになります"
            className="border-hairline text-ink-faint rounded-control border px-2 py-1 text-xs opacity-50"
          >
            コピー
          </button>
        </div>
      </FormSection>
    </CreatePage>
  )
}
