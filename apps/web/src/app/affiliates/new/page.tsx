'use client'

import { useEffect, useRef, useState } from 'react'
import type { Affiliate, Friend } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { NewAffiliateV8 } from '../new-affiliate-v8'
import CreatePage, {
  AsideCard,
  ChoiceCard,
  Field,
  FormSection,
} from '@/components/shared/create-page'
import { TextInput } from '@/components/shared/form-controls'
import Checkbox from '@/components/shared/checkbox'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'

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

function friendSearchParams(search: string, page: number, accountId: string) {
  return {
    limit: FRIEND_PAGE_SIZE,
    offset: String((Math.max(1, page) - 1) * FRIEND_PAGE_SIZE),
    search: search.trim() || undefined,
    includeTags: false,
    // 画面上部で選んでいるLINEアカウントへ検索を固定する。指定しないと
    // 他アカウントの友だちが混ざり、そのまま結びつけると登録先が
    // 選択中アカウントと食い違う（Issue #686 cross-account）。
    accountId,
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
  /* m22d: 金額は案件側で決まる（下の「1件あたりの報酬」と同じ説明）。
     「1件あたり」を注記にも書くと、同じ「1件」が3回出るので書かない。 */
  { value: 'per_conversion', label: '成果1件ごとに定額', note: '金額は案件の「報酬額」で決めます' },
  { value: 'rate', label: '売上に対する割合', note: '注文金額の◯%を報酬にします' },
  { value: 'none', label: '報酬なし（計測のみ）', note: '成果の件数だけを記録します' },
]

/*
 * 同時編集の比べ（板 Gqve5）。違う項目だけを「自分の変更（下書き）」と
 * 「今の保存内容」で並べる。差がなければ日時だけ進めて保存し直せる。
 * この画面だけの部品（共通部品は変えない）。
 */
function ConflictCompare({
  latest,
  draft,
  onAdoptLatest,
}: {
  latest: Affiliate
  draft: Record<string, string>
  onAdoptLatest: () => void
}) {
  const text = (value: string | number | boolean | null | undefined, empty: string): string => {
    if (value === null || value === undefined || value === '') return empty
    if (typeof value === 'boolean') return value ? 'する' : 'しない'
    return String(value)
  }
  const rows: Array<{ label: string; mine: string; theirs: string }> = [
    { label: '名前', mine: draft.name, theirs: text(latest.name, '—') },
    {
      label: '報酬率',
      mine: draft.commissionRate,
      theirs: latest.commissionRate != null ? `${latest.commissionRate}%` : '—',
    },
    { label: '連絡先メール', mine: draft.email, theirs: text(latest.email, '未登録') },
    {
      label: '保留期間',
      mine: draft.holdDays,
      theirs: latest.holdDays != null ? `${latest.holdDays}日` : '即確定',
    },
    { label: '支払いサイクル', mine: draft.payoutCycle, theirs: text(latest.payoutCycle, '未登録') },
    { label: '本人への通知', mine: draft.notifyOnConversion, theirs: text(latest.notifyOnConversion, '—') },
    { label: '計測', mine: draft.isActive, theirs: text(latest.isActive, '—') },
  ].filter((row) => row.mine !== row.theirs)
  if (rows.length === 0) {
    return (
      <div className="mt-2">
        <p>内容に違いはありません。最新の日時で保存し直せます。</p>
        <div className="mt-2">
          <Button type="button" onClick={onAdoptLatest}>
            最新の日時で保存し直す
          </Button>
        </div>
      </div>
    )
  }
  return (
    <table className="mt-2 w-full table-fixed text-xs" data-design-part="edit-conflict-compare">
      <caption className="py-1 text-left font-semibold">
        同じアフィリエイターの、違う項目だけ並べています。
      </caption>
      <thead>
        <tr className="text-left text-ink-secondary">
          <th className="w-28 py-1 pr-2 font-medium">項目</th>
          <th className="py-1 pr-2 font-medium">自分の変更（下書き）</th>
          <th className="py-1 font-medium">今の保存内容</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline">
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row" className="py-1 pr-2 text-left font-medium text-ink-secondary">{row.label}</th>
            <td className="truncate py-1 pr-2" title={row.mine}>{row.mine}</td>
            <td className="truncate py-1" title={row.theirs}>{row.theirs}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/*
 * ★V8-B の切り替え。v8 の器は別ファイル（new-affiliate-v8.tsx）に置き、
 * v7 の器・動きはこの下の V7 のまま残す。
 */
export default function NewAffiliatePage() {
  const theme = useAdminTheme()
  if (theme === 'v8') return <NewAffiliateV8 />
  return <NewAffiliatePageV7 />
}

function NewAffiliatePageV7() {
  /* ★V7: 画面名は共通トップバーにだけ置く。本文の重複見出しは出さない。 */
  usePageTitle('アフィリエイターを登録する')
  const { selectedAccountId, selectedAccount } = useAccount()
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
  /*
   * R525残部: 登録で確定した稼働状態（保存済みの真実）と、やり直しで送る
   * 指定（未保存の切り替え）は別に持つ。切り替えただけで知らせが
   * 「まだ始まっていない」「既に始まっている」と嘘をつかないようにする。
   */
  const [savedIsActive, setSavedIsActive] = useState<boolean | null>(null)
  // 作成の再送で二重登録にしないための、この登録試行1回分の安定した操作
  // UUID（Issue #686）。押し直しても同じ値のままにするため onSave では
  // 作らず、ここと onReset だけで作り直す。
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  /*
   * 同時編集の見分け（板 Gqve5）。追加情報の PUT は、作った・読んだときの
   * 更新日時を送る。ほかの人が先に保存していたら409になり、今の中身で
   * 帯を出して比べ直す。送らなければ今までどおり通す。
   */
  const [savedUpdatedAt, setSavedUpdatedAt] = useState<string | null>(null)
  const [conflictLatest, setConflictLatest] = useState<Affiliate | null>(null)
  const [comparing, setComparing] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [reloadFailed, setReloadFailed] = useState(false)

  /** 409 の data.latest を取り出す。形が違えば null（従来の失敗扱い）。 */
  function readConflictLatest(err: unknown): Affiliate | null {
    if (!(err instanceof ApiError) || err.status !== 409) return null
    const data = err.data as { latest?: unknown } | null | undefined
    const latest = data?.latest as Record<string, unknown> | null | undefined
    if (!latest || typeof latest !== 'object' || typeof latest.name !== 'string') return null
    return latest as unknown as Affiliate
  }

  /*
   * 日時を「10/2 14:02」の形にする。口が返すのは JST の壁時計なので、
   * 文字列から直接抜く（Date に通すと実行環境の時差でずれる）。
   * 読めなければ空文字。
   */
  function formatSavedAt(value: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value ?? '')
    if (!m) return ''
    return `${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`
  }

  /** 最新を読み直して見分けの基準にする。入力（下書き）は残す。 */
  async function reloadLatest() {
    if (!createdId || reloading) return
    setReloading(true)
    setReloadFailed(false)
    try {
      const res = await api.affiliates.get(createdId)
      if (!res.success) throw new Error('reload_failed')
      setSavedUpdatedAt(typeof res.data.updatedAt === 'string' ? res.data.updatedAt : null)
      setConflictLatest(null)
      setComparing(false)
    } catch {
      setReloadFailed(true)
    } finally {
      setReloading(false)
    }
  }

  /*
   * 途中保存の続きは、保存したときのLINEアカウントの中でだけ有効（#686）。
   *
   * ヘッダで別のアカウントへ切り替えても作りかけの `createdId` を持ち越すと、
   * 画面はBを指したまま「追加情報の保存を再開する」でAの紹介者をPUTで
   * 更新できてしまう。owner は404にならないので気づけない。
   * 切り替わったら登録の身元（createdId・操作UUID・途中保存の印）と、
   * 他アカウントでは選べない友だちの選択を捨てる。
   */
  const draftAccountRef = useRef(selectedAccountId)
  useEffect(() => {
    if (draftAccountRef.current === selectedAccountId) return
    draftAccountRef.current = selectedAccountId
    setCreatedId(null)
    setPartialSave(false)
    setSavedIsActive(null)
    setSavedUpdatedAt(null)
    setConflictLatest(null)
    setComparing(false)
    setReloadFailed(false)
    setOperationId(crypto.randomUUID())
    setFriendId('')
    setSelectedFriend(null)
    setFriendSearchInput('')
    setFriendSearch('')
    setFriendPage(1)
  }, [selectedAccountId])

  useEffect(() => {
    if (!selectedAccountId) {
      setFriends([])
      setFriendTotal(0)
      setFriendLoading(false)
      setFriendError('')
      return
    }
    let cancelled = false
    setFriendLoading(true)
    setFriendError('')
    void api.friends.list(friendSearchParams(friendSearch, friendPage, selectedAccountId)).then((result) => {
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
  }, [friendPage, friendReload, friendSearch, selectedAccountId])

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = code.trim() ? `${workerBase}/r/${code.trim()}` : null
  const friendPageCount = Math.max(1, Math.ceil(friendTotal / FRIEND_PAGE_SIZE))
  const friendOptions = selectedFriend && !friends.some((friend) => friend.id === selectedFriend.id)
    ? [selectedFriend, ...friends]
    : friends

  return (
    /* ★V8-B `RaMf3`（アフィリエイターを作る）：中身はこの画面そのもの。V6 の印は残す。 */
    <div data-design-node="RaMf3">
    <CreatePage
      title="アフィリエイターを登録する"
      description="紹介してくれる方に専用のリンクを渡し、成果と報酬を記録します。"
      parent={['成果とアフィリエイト', AFFILIATE_LIST_PATH]}
      successHref={(id) => `${AFFILIATE_LIST_PATH}&highlight=${encodeURIComponent(String(id))}`}
      saveLabel={partialSave ? '追加情報の保存を再開する' : '登録して、紹介リンクを発行する'}
      statusLabel={partialSave ? '基本情報は保存済み・追加情報は未保存' : undefined}
      showHeader={false}
      variant="v6"
      designNode="xqT1Z"
      validate={() => {
        if (!selectedAccountId) return 'LINEアカウントを選んでください（画面上部で選べます）'
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
        setSavedIsActive(null)
        setSavedUpdatedAt(null)
        setConflictLatest(null)
        setComparing(false)
        setReloadFailed(false)
        setOperationId(crypto.randomUUID())
      }}
      onSave={async () => {
        if (!selectedAccountId) {
          throw new Error('LINEアカウントを選んでください（画面上部で選べます）')
        }
        let affiliateId = createdId
        // 同じ保存操作の中で作って直ぐ直すとき、state の反映は間に合わない。
        // 送る基準は手元の変数で持ち、state へは次回のために残す。
        let baseline = savedUpdatedAt
        if (!affiliateId) {
          try {
            const res = await api.affiliates.create({
              name: name.trim(),
              code: code.trim() || undefined,
              commissionRate:
                payoutKind === 'rate' && commissionRate.trim() ? Number(commissionRate) : undefined,
              friendId: friendId || undefined,
              issueInitialLink: true,
              lineAccountId: selectedAccountId,
              operationId,
              // R525: 計測オフの登録は最初の行から停止で作る。追加情報の
              // 保存が失敗しても稼働では残らない。
              isActive: startTracking,
            })
            if (!res.success) throw new Error('create_failed')
            affiliateId = res.data.id
            setCreatedId(affiliateId)
            baseline = typeof res.data.updatedAt === 'string' ? res.data.updatedAt : null
            setSavedUpdatedAt(baseline)
            // 保存された行の稼働状態へ寄せる。応答消失後の再送が古い行を
            // 回収したときも、画面の表示と再試行の送り先がずれない。
            // 応答に稼働状態が無いときは送った指定のままにする。
            const persistedIsActive =
              typeof res.data.isActive === 'boolean' ? res.data.isActive : startTracking
            setStartTracking(persistedIsActive)
            setSavedIsActive(persistedIsActive)
          } catch {
            throw new Error('アフィリエイターを登録できませんでした。入力を確認して、もう一度お試しください。')
          }
        }
        // 連絡先・保留期間・支払いサイクル・通知は作成のAPIが受けないので、
        // 続けて更新する。1つの操作として見えるようにまとめる。
        // 計測の開始だけは作成のAPIへ渡す（R525）。更新でのみ送ると、
        // 更新の失敗時に稼働の行が残ってしまう。
        // 名前・報酬率も更新APIが受けるので、途中保存後にここを直して
        // 再開した分もまとめて送る（一部項目だけだと画面上の変更を失う、
        // Issue #686）。
        try {
          const update = await api.affiliates.update(affiliateId, {
            name: name.trim(),
            commissionRate:
              payoutKind === 'rate' && commissionRate.trim() ? Number(commissionRate) : undefined,
            email: email.trim() || null,
            holdDays: holdDays.trim() ? Number(holdDays) : null,
            payoutCycle: payoutCycle.trim() || null,
            notifyOnConversion,
            isActive: startTracking,
            expectedUpdatedAt: baseline ?? undefined,
          })
          if (!update.success) throw new Error('update_failed')
          if (typeof update.data.updatedAt === 'string') setSavedUpdatedAt(update.data.updatedAt)
        } catch (err) {
          // 409 は同時編集。帯で今の中身を見せ、入力（下書き）は残す。
          const latest = readConflictLatest(err)
          if (latest) {
            setConflictLatest(latest)
            setComparing(false)
            setPartialSave(true)
            throw new Error('ほかの人が先に保存しました。上の帯から内容を比べて続けてください。')
          }
          setPartialSave(true)
          throw new Error('基本情報は登録済みですが、追加情報を保存できませんでした。もう一度押すと、追加情報だけを保存します。')
        }
        setPartialSave(false)
        return affiliateId
      }}
      aside={
        <>
          <AsideCard title="成果が出たときにすること">
            <Checkbox
              checked={notifyOnConversion}
              onCheckedChange={setNotifyOnConversion}
              description="報酬が確定したタイミングで届きます"
              className="border-hairline rounded-control border p-3"
            >本人へメールで知らせる</Checkbox>
            <Checkbox
              checked={startTracking}
              onCheckedChange={setStartTracking}
              description="オフでもリンクは発行されます"
              className="border-hairline mt-2 rounded-control border p-3"
            >すぐに計測を始める</Checkbox>
            {/* ★V7: 未接続の断り書きは出さない。接続後に項目として出す。 */}
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
      {conflictLatest ? (
        <div data-design-node="Gqve5">
        <Notice tone="warn" data-design-part="edit-conflict-band">
          <p className="font-semibold">
            {formatSavedAt(conflictLatest.updatedAt)
              ? `ほかの人が${formatSavedAt(conflictLatest.updatedAt)}にこのアフィリエイターを保存しました。`
              : 'ほかの人がこのアフィリエイターを保存しました。'}
            このまま保存すると、その人の変更が消えます。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => setComparing((v) => !v)}
              aria-expanded={comparing}
            >
              {comparing ? '比べを閉じる' : '違いを比べる'}
            </Button>
            <Button
              type="button"
              onClick={() => void reloadLatest()}
              disabled={reloading}
            >
              {reloading ? '読み込んでいます…' : '最新を読み込んで続ける'}
            </Button>
          </div>
          {reloadFailed ? (
            <p className="mt-2">最新の内容を読み込めませんでした。通信を確かめて、もう一度押してください。</p>
          ) : null}
          {comparing ? <ConflictCompare latest={conflictLatest} draft={{
            name: name.trim(),
            commissionRate: payoutKind === 'rate' && commissionRate.trim() ? `${commissionRate.trim()}%` : '—',
            email: email.trim() || '未登録',
            holdDays: holdDays.trim() ? `${holdDays.trim()}日` : '即確定',
            payoutCycle: payoutCycle.trim() || '未登録',
            notifyOnConversion: notifyOnConversion ? 'する' : 'しない',
            isActive: startTracking ? 'する' : 'しない',
          }}
            onAdoptLatest={() => {
              if (typeof conflictLatest?.updatedAt === 'string') {
                setSavedUpdatedAt(conflictLatest.updatedAt)
              }
              setConflictLatest(null)
              setComparing(false)
            }}
          /> : null}
        </Notice>
        </div>
      ) : null}
      <FormSection step={1} label="だれを登録するか">
        {partialSave && createdId ? (
          <Notice
            tone="warn"
            action={
              <a href={`${AFFILIATE_LIST_PATH}&highlight=${encodeURIComponent(createdId)}`}>
                未保存の追加情報を破棄して一覧へ戻る
              </a>
            }
          >
            <p className="font-semibold">基本情報は保存済みです</p>
            <p className="mt-1">
              下の「追加情報の保存を再開する」で続けるか、未保存の追加情報を破棄して一覧へ戻れます。
            </p>
            {/*
              R525残部: 知らせの1文目は保存済みの真実（savedIsActive）だけを
              言う。未保存の切り替え（startTracking）は2文目で「再開するとき
              どう送るか」として別に言う。混ぜると、オン保存→オフ切替で
              「まだ始まっていない」、オフ保存→オン切替で「既に始まっている」
              と嘘をつく。失敗・警告の文なので ? には入れない。
            */}
            {savedIsActive === true ? (
              <p className="mt-1">
                基本情報の登録で計測は既に始まっています。
                {startTracking
                  ? 'このまま追加情報だけを保存します。'
                  : '再開するときは計測をオフに切り替えて保存します。'}
              </p>
            ) : savedIsActive === false ? (
              <p className="mt-1">
                基本情報の登録は計測オフで済んでいるので、計測はまだ始まっていません。
                {startTracking
                  ? '再開するときは計測をオンに切り替えて保存します。'
                  : 'このまま追加情報だけを保存します。'}
              </p>
            ) : (
              <p className="mt-1">
                {startTracking
                  ? '「すぐに計測を始める」がオンなので、基本情報の登録で計測は既に始まっています。'
                  : '「すぐに計測を始める」がオフなので、計測は始まらないまま追加情報だけを保存します。'}
              </p>
            )}
          </Notice>
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

        <Field
          label="LINEの友だちと結びつける（任意）"
          htmlFor="af-friend"
          note={
            selectedAccount
              ? `「${selectedAccount.name}」の友だちだけを、名前で絞り込み20件ずつ確認できます。結びつけると、成果が出たときに本人へ知らせられます。`
              : '名前で絞り込み、20件ずつ確認できます。結びつけると、成果が出たときに本人へ知らせられます。'
          }
        >
          {!selectedAccountId ? (
            <p className="text-ink-faint text-sm">画面上部でLINEアカウントを選ぶと、友だちを検索できます。</p>
          ) : (
            <>
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
                  className="text-accent-deep hover:bg-accent-soft rounded-control px-4 py-2 text-sm font-semibold"
                >
                  検索
                </button>
              </form>
              <Select
                id="af-friend"
                aria-label="LINEの友だちと結びつける"
                value={friendId}
                onChange={(nextId) => {
                  setFriendId(nextId)
                  setSelectedFriend(friendOptions.find((friend) => friend.id === nextId) ?? null)
                }}
                className="w-full max-w-lg"
                size="full"
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
                    className="text-accent-deep hover:bg-accent-soft rounded-control px-3 py-1 font-semibold"
                  >
                    もう一度読み込む
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex max-w-lg flex-wrap items-center justify-between gap-2">
                  <p className="text-ink-faint text-xs tabular-nums">
                    {friendLoading ? '友だちを読み込んでいます' : `全${formatNumber(friendTotal)}件`}
                  </p>
                  {friendPageCount > 1 ? (
                    <Select
                      id="af-friend-page"
                      aria-label="友だち候補のページ"
                      value={String(friendPage)}
                      onChange={(value) => setFriendPage(Number(value))}
                      disabled={friendLoading}
                      className="w-40"
                      size="standard"
                      options={Array.from({ length: friendPageCount }, (_, index) => ({
                        value: String(index + 1),
                        label: `${index + 1} / ${friendPageCount}ページ`,
                      }))}
                    />
                  ) : null}
                </div>
              )}
            </>
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
          {/* ★V7: 未接続の断り書きは出さない。接続後に項目として出す。 */}
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
          {/* ★V7: 未接続の断り書きは出さない。接続後に項目として出す。 */}
          <div className="border-hairline rounded-control border px-3 py-2">
          <p className="text-ink-secondary text-xs font-semibold">この方に渡すURL</p>
          <div className="flex items-center gap-2">
            <code className="text-ink-secondary min-w-0 flex-1 truncate text-xs">
              {previewUrl ?? '—'}
            </code>
            {previewUrl && (
              <Button variant="secondary" className="px-2 py-1 text-xs h-auto whitespace-normal" type="button" onClick={() => {
                  void navigator.clipboard?.writeText(previewUrl).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  )
                }}>
                コピー
              </Button>
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
    </div>
  )
}
