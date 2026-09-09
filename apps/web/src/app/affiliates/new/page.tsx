'use client'

import { useEffect, useState } from 'react'
import type { Friend } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, {
  AsideCard,
  ChoiceCard,
  Field,
  FormSection,
} from '@/components/shared/create-page'
import { TextInput } from '@/components/shared/form-controls'
import SelectField from '@/components/shared/select-field'

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
const FRIEND_PAGE_SIZE = 20
const AFFILIATE_LIST_PATH = '/conversions?tab=affiliates'

function friendSearchParams(search: string, page: number) {
  return {
    limit: FRIEND_PAGE_SIZE,
    offset: String((Math.max(1, page) - 1) * FRIEND_PAGE_SIZE),
    search: search.trim() || undefined,
    includeTags: false,
  }
}

function commissionRateError(payoutKind: PayoutKind, value: string): string | null {
  if (payoutKind !== 'rate') return null
  if (!value.trim()) return '売上に対する割合を入力してください'
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return '売上に対する割合は0から100の間で入力してください'
  }
  return null
}

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
 * アフィリエイターを追加する（設計 V6 `xqT1Z`）。
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
  const [friends, setFriends] = useState<Friend[]>([])
  const [friendId, setFriendId] = useState('')
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null)
  const [friendSearchInput, setFriendSearchInput] = useState('')
  const [friendSearch, setFriendSearch] = useState('')
  const [friendPage, setFriendPage] = useState(1)
  const [friendTotal, setFriendTotal] = useState(0)
  const [friendLoading, setFriendLoading] = useState(true)
  const [friendError, setFriendError] = useState('')
  const [friendReload, setFriendReload] = useState(0)
  const [copied, setCopied] = useState(false)
  // 作成後の追加情報保存だけが失敗した場合、再押下で同じ紹介者を増やさず
  // 追加情報の保存だけをやり直す。
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [partialSave, setPartialSave] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFriendLoading(true)
    setFriendError('')
    void api.friends.list(friendSearchParams(friendSearch, friendPage)).then((result) => {
      if (cancelled) return
      if (!result.success) throw new Error('friends_failed')
      setFriends(result.data.items as unknown as Friend[])
      setFriendTotal(result.data.total)
    }).catch(() => {
      if (cancelled) return
      setFriends([])
      setFriendTotal(0)
      setFriendError('友だちを読み込めませんでした。条件を変えるか、もう一度お試しください。')
    }).finally(() => {
      if (!cancelled) setFriendLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [friendPage, friendReload, friendSearch])

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = code.trim() ? `${workerBase}/r/${code.trim()}` : null
  const friendPageCount = Math.max(1, Math.ceil(friendTotal / FRIEND_PAGE_SIZE))
  const friendOptions = selectedFriend && !friends.some((friend) => friend.id === selectedFriend.id)
    ? [selectedFriend, ...friends]
    : friends

  return (
    <CreatePage
      title="アフィリエイターを登録する"
      description="紹介してくれる方に専用のリンクを渡し、成果と報酬を記録します。"
      parent={['成果とアフィリエイト', AFFILIATE_LIST_PATH]}
      successHref={(id) => `${AFFILIATE_LIST_PATH}&highlight=${encodeURIComponent(String(id))}`}
      saveLabel={partialSave ? '追加情報の保存を再開する' : '登録して、紹介リンクを発行する'}
      statusLabel={partialSave ? '基本情報は保存済み・追加情報は未保存' : undefined}
      variant="v6"
      designNode="xqT1Z"
      validate={() => {
        if (!name.trim()) return '名前・屋号を入力してください'
        // worker の CODE_RE は英数字4文字以上。ハイフンは弾かれる。
        if (code.trim() && !/^[A-Za-z0-9]{4,}$/.test(code.trim())) {
          return '紹介コードは英数字4文字以上で入力してください'
        }
        const rateError = commissionRateError(payoutKind, commissionRate)
        if (rateError) return rateError
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
        setFriendId('')
        setSelectedFriend(null)
        setNotifyOnConversion(true)
        setStartTracking(true)
        setCopied(false)
        setCreatedId(null)
        setPartialSave(false)
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
              friendId: friendId || undefined,
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
          setPartialSave(true)
          throw new Error('基本情報は登録済みですが、追加情報を保存できませんでした。もう一度押すと、追加情報だけを保存します。')
        }
        setPartialSave(false)
        return affiliateId
      }}
      aside={
        <>
          <AsideCard title="成果が出たときにすること">
            <label className="border-hairline flex items-start gap-2 rounded-control border p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={notifyOnConversion} onChange={(e) => setNotifyOnConversion(e.target.checked)} />
              <span><strong className="text-ink block">本人へメールで知らせる</strong><span className="text-ink-faint text-xs">報酬が確定したタイミングで届きます</span></span>
            </label>
            <label className="border-hairline mt-2 flex items-start gap-2 rounded-control border p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={startTracking} onChange={(e) => setStartTracking(e.target.checked)} />
              <span><strong className="text-ink block">すぐに計測を始める</strong><span className="text-ink-faint text-xs">オフでもリンクは発行されます</span></span>
            </label>
            <Unavailable label="成果時の動き" reason="まだ繋がっていません。紹介者ごとの成果時の動きが接続されると表示されます。" />
          </AsideCard>

          <AsideCard title="つながる先">
            <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
              <li>・案件：この人に紹介してもらうもの</li>
              <li>・流入と計測：発行する紹介リンク</li>
              <li>・友だち属性：紹介で来た人に付くタグ</li>
              <li>・成果承認：認めたあとに報酬へ反映</li>
              <li>・支払い：締め日と振込先</li>
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
      <FormSection step={1} label="だれを登録するか">
        {partialSave && createdId ? (
          <div role="alert" className="border-warning bg-warning-bg rounded-control border px-3 py-2 text-sm">
            <p className="text-ink font-semibold">基本情報は保存済みです</p>
            <p className="text-ink-secondary mt-1">
              下の「追加情報の保存を再開する」で続けるか、未保存の追加情報を破棄して一覧へ戻れます。
            </p>
            <a
              href={`${AFFILIATE_LIST_PATH}&highlight=${encodeURIComponent(createdId)}`}
              className="text-danger mt-2 inline-block font-semibold underline"
            >
              未保存の追加情報を破棄して一覧へ戻る
            </a>
          </div>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-3">
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
          note="登録したあとは変えられません。英数字4文字以上。空欄にすると、推測されにくいコードを自動で作ります（現在は - _ を利用できません）。"
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
        </div>

        <Field label="LINEの友だちと結びつける（任意）" htmlFor="af-friend" note="名前で絞り込み、20件ずつ確認できます。結びつけると、成果が出たときに本人へ知らせられます。">
          <form
            className="mb-2 flex max-w-lg flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setFriendPage(1)
              setFriendSearch(friendSearchInput.trim())
              setFriendReload((value) => value + 1)
            }}
          >
            <TextInput
              aria-label="友だちの名前で検索"
              value={friendSearchInput}
              onChange={(event) => setFriendSearchInput(event.target.value)}
              placeholder="友だちの名前で探す"
              className="min-w-56 flex-1"
            />
            <button
              type="submit"
              className="text-accent hover:bg-accent-soft rounded-control px-4 py-2 text-sm font-semibold"
            >
              検索
            </button>
          </form>
          <SelectField
            id="af-friend"
            aria-label="LINEの友だちと結びつける"
            value={friendId}
            onChange={(event) => {
              const nextId = event.target.value
              setFriendId(nextId)
              setSelectedFriend(friendOptions.find((friend) => friend.id === nextId) ?? null)
            }}
            className="w-full max-w-lg"
            options={[
              { value: '', label: friendLoading ? '読み込んでいます' : '結びつけない' },
              ...friendOptions.map((friend) => ({ value: friend.id, label: friend.displayName })),
            ]}
          />
          {friendError ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <p className="text-danger">{friendError}</p>
              <button
                type="button"
                onClick={() => setFriendReload((value) => value + 1)}
                className="text-accent hover:bg-accent-soft rounded-control px-3 py-1 font-semibold"
              >
                もう一度読み込む
              </button>
            </div>
          ) : (
            <div className="mt-2 flex max-w-lg flex-wrap items-center justify-between gap-2">
              <p className="text-ink-faint text-xs tabular-nums">
                {friendLoading ? '友だちを読み込んでいます' : `全${friendTotal.toLocaleString('ja-JP')}件`}
              </p>
              {friendPageCount > 1 ? (
                <SelectField
                  id="af-friend-page"
                  aria-label="友だち候補のページ"
                  value={String(friendPage)}
                  onChange={(event) => setFriendPage(Number(event.target.value))}
                  disabled={friendLoading}
                  className="w-40"
                  options={Array.from({ length: friendPageCount }, (_, index) => ({
                    value: String(index + 1),
                    label: `${index + 1} / ${friendPageCount}ページ`,
                  }))}
                />
              ) : null}
            </div>
          )}
        </Field>
      </FormSection>

      <FormSection step={2} label="いくら払い、いつ締めるか">
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

        <div className="grid gap-3 sm:grid-cols-2">
          <Unavailable label="成果として数えるもの" reason="案件ごとに決めます。" />
          <Unavailable label="1件あたりの上限" reason="まだ繋がっていません。上限回数が接続されると表示されます。" />
        </div>
      </FormSection>

      <FormSection step={3} label="いつ締めて、いつ払うか">
        <div className="grid gap-3 lg:grid-cols-4">
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
          <Unavailable label="振込先の登録" reason="まだ繋がっていません。銀行・支店・種別・末尾4桁が接続されると表示されます。" />
          <div className="border-hairline rounded-control border px-3 py-2">
          <p className="text-ink-secondary text-xs font-semibold">この方に渡すURL</p>
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
        </div>
      </FormSection>
    </CreatePage>
  )
}
