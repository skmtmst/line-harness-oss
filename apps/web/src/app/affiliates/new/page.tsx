'use client'

import { useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, {
  AsideCard,
  ChoiceCard,
  Field,
  FormSection,
} from '@/components/shared/create-page'
import { TextInput } from '@/components/shared/form-controls'

/**
 * 入力欄の幅。
 *
 * 設計 `xqT1Z` は欄ごとに幅を書き分けている。名前は屋号まで、コードは
 * URLの末尾、メールはドメインまでが1行に収まる幅。全部を100%にすると、
 * 4文字のコード欄が画面の端まで伸びて「ここに何文字入れるのか」が
 * 読めなくなる。狭い画面では `max-w-full` で折り返す。
 */
const W_NAME = 'w-[360px] max-w-full'
const W_CODE = 'w-[320px] max-w-full'
const W_EMAIL = 'w-[340px] max-w-full'
const W_RATE = 'w-[200px] max-w-full tabular-nums'
const W_HOLD = 'w-[220px] max-w-full tabular-nums'

/**
 * 決められない項目の出し方。
 *
 * 押せない入力欄を置くと「入れられるのに反映されない欄」に見える。値が
 * 決まる場所がここではないなら、`—` と理由だけを出す。
 */
function Unavailable({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="border-hairline rounded-control bg-canvas-sunken border px-3 py-2">
      <p className="text-ink-secondary text-label font-semibold">{label}</p>
      <p className="text-ink text-label tabular-nums">—</p>
      <p className="text-ink-faint text-micro mt-0.5">{reason}</p>
    </div>
  )
}

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
  const [notifyOnConversion, setNotifyOnConversion] = useState(true)
  const [startTracking, setStartTracking] = useState(true)
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [copied, setCopied] = useState(false)
  // 作成後の追加情報保存だけが失敗した場合、再押下で同じ紹介者を増やさず
  // 追加情報の保存だけをやり直す。
  const [createdId, setCreatedId] = useState<string | null>(null)

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
      variant="v6"
      designNode="xqT1Z"
      validate={() => {
        if (!name.trim()) return '名前・屋号を入力してください'
        // worker の CODE_RE は英数字4文字以上。ハイフンは弾かれる。
        if (code.trim() && !/^[A-Za-z0-9]{4,}$/.test(code.trim())) {
          return '紹介コードは英数字4文字以上で入力してください'
        }
        if (payoutKind === 'rate' && !commissionRate.trim()) {
          return '売上に対する割合を入力してください'
        }
        if (payoutKind === 'rate') {
          const rate = Number(commissionRate)
          if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
            return '売上に対する割合は0より大きく100以下で入力してください'
          }
        }
        if (holdDays.trim()) {
          const days = Number(holdDays)
          if (!Number.isInteger(days) || days < 0 || days > 365) {
            return '確定までの保留期間は0日から365日の整数で入力してください'
          }
        }
        return null
      }}
      onReset={() => {
        setName('')
        setEmail('')
        setCode('')
        setPayoutKind('per_conversion')
        setCommissionRate('')
        setHoldDays('30')
        setPayoutCycle('')
        setNotifyOnConversion(true)
        setStartTracking(true)
        setCopied(false)
        setCreatedId(null)
      }}
      onSave={async () => {
        let affiliateId = createdId
        if (!affiliateId) {
          try {
            const res = await api.affiliates.create({
              name: name.trim(),
              code: code.trim() || undefined,
              commissionRate:
                payoutKind === 'rate' && commissionRate.trim() ? Number(commissionRate) : undefined,
              issueInitialLink: true,
            })
            if (!res.success) throw new Error('create_failed')
            affiliateId = res.data.id
            setCreatedId(affiliateId)
          } catch {
            throw new Error('アフィリエイターを登録できませんでした。入力を確認して、もう一度お試しください。')
          }
        }
        // 連絡先・保留期間・支払いサイクル・通知・計測の開始は作成のAPIが
        // 受けないので、続けて更新する。1つの操作として見えるようにまとめる。
        try {
          const update = await api.affiliates.update(affiliateId, {
            email: email.trim() || null,
            holdDays: holdDays.trim() ? Number(holdDays) : null,
            payoutCycle: payoutCycle.trim() || null,
            notifyOnConversion,
            isActive: startTracking,
          })
          if (!update.success) throw new Error('update_failed')
        } catch {
          throw new Error('基本情報は登録済みですが、追加情報を保存できませんでした。もう一度押すと、追加情報だけを保存します。')
        }
        return affiliateId
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
          <TextInput
            id="af-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：ペットライフ編集部"
            className={W_NAME}
          />
        </Field>

        <Field label="連絡先メール" htmlFor="af-email" note="報酬の確定連絡に使います。">
          <TextInput
            id="af-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contact@example.com"
            className={W_EMAIL}
          />
        </Field>

        <Field
          label="紹介コード"
          htmlFor="af-code"
          note="URLの末尾に使われます。英数字4文字以上。空欄にすると、推測されにくいコードを自動で作ります（そのほうが、他の人にコードを当てられて成果を横取りされる心配がありません）。"
        >
          <TextInput
            id="af-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="petlife2026"
            className={W_CODE}
          />
        </Field>

        {/* 設計 xqT1Z にある「友だち検索」。作成のAPIが友だちIDを受けない。 */}
        <Unavailable
          label="友だちから選ぶ"
          reason="まだ繋がっていません。友だち検索が接続されると表示されます。"
        />
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
          <Unavailable
            label="1件あたりの報酬"
            reason="金額は案件の「報酬額」で決まります。ここでは決められません。"
          />
        )}

        {payoutKind === 'rate' && (
          <Field label="売上に対する割合" htmlFor="af-rate">
            <div className="flex items-center gap-1.5">
              <TextInput
                id="af-rate"
                type="number"
                min={0}
                step="0.1"
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)}
                placeholder="10"
                className={W_RATE}
              />
              <span className="text-ink-faint text-sm">%</span>
            </div>
          </Field>
        )}

        {/* 何をもって成果とするかは案件（offer）側で決まる。ここに置くと、
            同じことを2か所で決められるように見える。 */}
        <Unavailable
          label="成果として数えるもの"
          reason="何を成果として数えるかは案件ごとに決めます。ここでは決められません。"
        />

        {/* 設計 xqT1Z にある「1件あたりの上限」。回数を持つ列が無い。 */}
        <Unavailable
          label="1件あたりの上限"
          reason="まだ繋がっていません。上限の回数が接続されると表示されます。"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="確定までの保留期間"
            htmlFor="af-hold"
            note="返品・キャンセルを考慮する期間です。"
          >
            <div className="flex items-center gap-1.5">
              <TextInput
                id="af-hold"
                type="number"
                min={0}
                max={365}
                value={holdDays}
                onChange={(e) => setHoldDays(e.target.value)}
                className={W_HOLD}
              />
              <span className="text-ink-faint text-sm">日</span>
            </div>
          </Field>

          <Field label="支払いサイクル" htmlFor="af-cycle" note="取り決めの記録です。">
            <TextInput
              id="af-cycle"
              type="text"
              value={payoutCycle}
              onChange={(e) => setPayoutCycle(e.target.value)}
              placeholder="例：月末締め翌月末払い"
              maxLength={100}
              className={W_EMAIL}
            />
          </Field>
        </div>

        {/* アフィリエイターにアカウントを紐づける列が無い。案件側にはある。 */}
        <Unavailable
          label="対象アカウント"
          reason={`対象は案件ごとに決めます（登録済み ${accounts.length}件）。ここでは決められません。`}
        />

        {/* 設計 xqT1Z にある「振込先の登録」。口座を持つ列が無い。 */}
        <Unavailable
          label="振込先の登録"
          reason="まだ繋がっていません。振込先が接続されると表示されます。"
        />
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

        {/* 設計 xqT1Z にある「成果時の動き」。タグ付けとシナリオ開始は案件側にある。 */}
        <Unavailable
          label="成果時の動き"
          reason="まだ繋がっていません。紹介者ごとの成果時の動きが接続されると表示されます。"
        />
      </FormSection>

      <FormSection step={4} label="この方に渡すURL" note="保存すると確定します。">
        {/* コードを空欄にすると worker が自動で作るので、保存前はURLが決まらない。
            決まっていないものを「コピー」させると、届かないURLを配れてしまう。
            入力したコードがあるときだけ押せる形にして、無いときは理由を出す。 */}
        <div className="border-hairline rounded-control border px-3 py-2">
          <div className="flex items-center gap-2">
            <code className="text-ink-secondary min-w-0 flex-1 truncate text-xs">
              {previewUrl ?? '—'}
            </code>
            {previewUrl && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(previewUrl).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  )
                }}
                className="border-hairline text-ink rounded-control hover:bg-canvas-sunken border px-2 py-1 text-xs font-semibold"
              >
                コピー
              </button>
            )}
          </div>
          <p className="text-ink-faint text-micro mt-1">
            {previewUrl
              ? copied
                ? 'コピーしました。保存すると、このURLで確定します。'
                : '保存すると、このURLで確定します。'
              : '紹介コードを空欄のままにすると、保存したときに自動で決まります。決まる前のURLはコピーできません。'}
          </p>
        </div>
      </FormSection>
    </CreatePage>
  )
}
