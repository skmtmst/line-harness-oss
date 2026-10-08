'use client'

/*
 * ★V8 アフィリエイターを作る（板 `RaMf3`、紹介コードがぶつかったときは `Gqve5` の帯の形）。
 *
 * app/affiliates/new-affiliate-v8.tsx から動きを写し、作る型（CreatePage）で組み直した。
 * データの口・動きは今と同じ：登録（合言葉 operationId つき）→ 追加情報の保存。追加情報だけ
 * 失敗したら、もう一度押すと追加情報だけを保存する。友だちとの結びつけ・離れる前の確かめ。
 *
 * 絵との違い：
 * - 「タグを付ける」の段は、登録の口にタグを付ける項目が無いので置かない。同じ場所に
 *   「すぐに計測を始める」（今の画面にある）を同じ形で置く。
 * - 競合の帯（Gqve5）の「だれが・いつ保存したか」は口が返さないので出さない。紹介コードの
 *   重なり（既に使われている）のときに、同じ場所・同じ形で出す。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronLeft, Link as LinkIcon, List, TriangleAlert } from 'lucide-react'
import type { Friend } from '@line-crm/shared'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import { distributionUrl } from './display'
import styles from './create.module.css'

const FRIEND_PAGE_SIZE = 20
const LIST_PATH = '/affiliates'

type PayoutKind = 'per_conversion' | 'rate' | 'none'

/* 絵（RaMf3）の並び：報酬なし → 割合 → 1件ごと。 */
const PAYOUT_KINDS: Array<{ value: PayoutKind; label: string; note: string }> = [
  { value: 'none', label: '報酬なし（計測のみ）', note: '成果の件数だけを記録' },
  { value: 'rate', label: '売上に対する割合', note: '注文金額の ◯% を報酬に' },
  { value: 'per_conversion', label: '成果1件ごとに定額', note: '金額は案件の「報酬額」で' },
]

const HOLD_DAY_CHOICES = [0, 3, 7, 14, 30, 60, 90]

function friendSearchParams(search: string, page: number, accountId: string) {
  return {
    limit: FRIEND_PAGE_SIZE,
    offset: String((Math.max(1, page) - 1) * FRIEND_PAGE_SIZE),
    search: search.trim() || undefined,
    includeTags: false,
    accountId,
  }
}

function commissionRateError(payoutKind: PayoutKind, value: string): string | null {
  if (payoutKind !== 'rate') return null
  if (!value.trim()) return '売上に対する割合を入力してください'
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return '売上に対する割合は0から100の間で入力してください'
  return null
}

export default function CreateAffiliateV8() {
  usePageTitle('アフィリエイターを作る')
  /* 板の頭の「← 〇〇へ」は 2026-10-08 に無くした。一覧へは上の帯のパンくずで戻る。 */
  usePageCrumbs([{ label: '成果とアフィリエイト', href: LIST_PATH }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
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
  const [friendPickerOpen, setFriendPickerOpen] = useState(false)
  const [linkBaseUrl, setLinkBaseUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [partialSave, setPartialSave] = useState(false)
  const [savedIsActive, setSavedIsActive] = useState<boolean | null>(null)
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveNote, setSaveNote] = useState('')
  /* 紹介コードの重なり（ほかの人が先に同じコードで登録した）。入力は残す。 */
  const [codeConflict, setCodeConflict] = useState(false)

  /* 配布URLの土台（短縮ドメイン）。できる紹介リンクの形を見せるのに使う。 */
  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => api.accountSettings.getLinkBaseUrl()).then((res) => {
      if (!cancelled && res.success && typeof res.data === 'string') setLinkBaseUrl(res.data)
    }).catch(() => { /* 取れなくても /r/ の形で見せる */ })
    return () => { cancelled = true }
  }, [])

  /* アカウントを切り替えたら、前のアカウントの登録の続きは捨てる。 */
  const draftAccountRef = useRef(selectedAccountId)
  useEffect(() => {
    if (draftAccountRef.current === selectedAccountId) return
    draftAccountRef.current = selectedAccountId
    setCreatedId(null)
    setIssuedUrl(null)
    setPartialSave(false)
    setSavedIsActive(null)
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
    return () => { cancelled = true }
  }, [friendPage, friendReload, friendSearch, selectedAccountId])

  const friendPageCount = Math.max(1, Math.ceil(friendTotal / FRIEND_PAGE_SIZE))
  const friendOptions = selectedFriend && !friends.some((friend) => friend.id === selectedFriend.id) ? [selectedFriend, ...friends] : friends
  /* 発行済みなら本物のURL。まだなら、入力した紹介コードで発行される形（空欄なら自動で作るので「—」）。 */
  const previewUrl = issuedUrl ?? (code.trim() ? distributionUrl(code.trim(), linkBaseUrl).replace(/^https?:\/\//, '') : null)

  const validate = (): string | null => {
    if (!selectedAccountId) return 'LINEアカウントを選んでください（画面上部で選べます）'
    if (!name.trim()) return '名前・屋号を入力してください'
    if (code.trim() && !/^[A-Za-z0-9]{4,}$/.test(code.trim())) return '紹介コードは英数字4文字以上で入力してください'
    const rateError = commissionRateError(payoutKind, commissionRate)
    if (rateError) return rateError
    if (holdDays.trim()) {
      const days = Number(holdDays)
      if (!Number.isInteger(days) || days < 0 || days > 365) return '確定までの保留期間は0日から365日の整数で入力してください'
    }
    return null
  }

  const reset = () => {
    setName('')
    setEmail('')
    setCode('')
    setCodeConflict(false)
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
    setIssuedUrl(null)
    setPartialSave(false)
    setSavedIsActive(null)
    setOperationId(crypto.randomUUID())
  }

  const save = async (): Promise<string> => {
    if (!selectedAccountId) throw new Error('LINEアカウントを選んでください（画面上部で選べます）')
    let affiliateId = createdId
    if (!affiliateId) {
      try {
        const res = await api.affiliates.create({
          name: name.trim(),
          code: code.trim() || undefined,
          commissionRate: payoutKind === 'rate' && commissionRate.trim() ? Number(commissionRate) : undefined,
          friendId: friendId || undefined,
          issueInitialLink: true,
          lineAccountId: selectedAccountId,
          operationId,
          isActive: startTracking,
        })
        if (!res.success) {
          if ((res.error ?? '').includes('既に使われています')) {
            setCodeConflict(true)
            throw new Error('この紹介コードは既に使われています。別のコードを入力してください。')
          }
          throw new Error('create_failed')
        }
        affiliateId = res.data.id
        setCreatedId(affiliateId)
        setIssuedUrl(res.link?.url ?? null)
        const persistedIsActive = typeof res.data.isActive === 'boolean' ? res.data.isActive : startTracking
        setStartTracking(persistedIsActive)
        setSavedIsActive(persistedIsActive)
      } catch (caught) {
        if (caught instanceof Error && caught.message.includes('既に使われています')) {
          setCodeConflict(true)
          throw new Error('この紹介コードは既に使われています。別のコードを入力してください。')
        }
        throw new Error('アフィリエイターを登録できませんでした。入力を確認して、もう一度お試しください。')
      }
    }
    try {
      const update = await api.affiliates.update(affiliateId, {
        name: name.trim(),
        commissionRate: payoutKind === 'rate' && commissionRate.trim() ? Number(commissionRate) : undefined,
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
  }

  const runSave = async (after: 'continue' | 'finish') => {
    if (saving) return
    const invalid = validate()
    if (invalid) {
      setSaveError(invalid)
      setSaveNote('')
      return
    }
    setSaving(true)
    setSaveError('')
    setSaveNote('')
    setCodeConflict(false)
    try {
      const affiliateId = await save()
      if (after === 'finish' || partialSave) {
        router.push(`${LIST_PATH}?affiliate=${encodeURIComponent(affiliateId)}&highlight=${encodeURIComponent(affiliateId)}`)
      } else {
        reset()
        setSaveNote('保存しました。続けて作れます。')
      }
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : '保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  const dirty = Boolean(
    name || email || code || payoutKind !== 'per_conversion' || commissionRate
    || holdDays !== '30' || payoutCycle || friendId || !notifyOnConversion || !startTracking,
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const holdOptions = [...new Set([...HOLD_DAY_CHOICES, ...(holdDays.trim() && Number.isInteger(Number(holdDays)) ? [Number(holdDays)] : [])])]
    .sort((a, b) => a - b)
    .map((days) => ({ value: String(days), label: days === 0 ? '保留しない（すぐ確定）' : `${days}日（取り消しを待つ）` }))

  const preview = (
    <div className={styles.rail}>
      <section className={styles.sideCard} aria-label="できる紹介リンク">
        <h2 className={styles.sideTitle}>できる紹介リンク</h2>
        <p className={styles.sideNote}>{issuedUrl ? '発行しました' : '登録すると発行されます'}</p>
        <dl className={styles.kvList}>
          <div className={styles.kvRow}>
            <dt>リンク</dt>
            <dd title={previewUrl ?? undefined}>{previewUrl ?? '—'}</dd>
          </div>
          <div className={styles.kvRow}>
            <dt>報酬</dt>
            <dd>{payoutKind === 'none' ? '計測のみ' : payoutKind === 'rate' ? `売上の ${commissionRate.trim() || '◯'}%` : '1件ごと（案件の額）'}</dd>
          </div>
          <div className={styles.kvRow}>
            <dt>締め</dt>
            <dd>{payoutCycle.trim() || '—'}</dd>
          </div>
        </dl>
        {issuedUrl ? (
          <div>
            <Button type="button" onClick={() => { void navigator.clipboard?.writeText(issuedUrl).then(() => setCopied(true), () => setCopied(false)) }}>
              {copied ? 'コピーしました' : 'リンクをコピー'}
            </Button>
          </div>
        ) : null}
      </section>
      <section className={styles.sideCard} aria-label="気をつけること">
        <h2 className={styles.sideTitle}>気をつけること</h2>
        <p className={styles.sideList}>
          ・紹介コードはあとから変えられません（配ったリンクが動かなくなるため）
          <br />
          ・報酬を払う人は、振込先の登録が要ります
        </p>
      </section>
    </div>
  )

  return (
    <CreatePage
      boardId="RaMf3"
      title="アフィリエイターを作る"
      description="登録すると紹介リンクができます。成果はその人の紹介リンクから来た人で数えます。"
      identity={<Link href={LIST_PATH} className={styles.backLink}><ChevronLeft size={14} aria-hidden="true" />成果とアフィリエイトへ</Link>}
      preview={preview}
      /* 競合の帯は2列の上に全幅で出す（絵 Gqve5）。 */
      notice={codeConflict ? (
      <div className={styles.conflict} role="alert">
        <TriangleAlert size={16} aria-hidden="true" className={styles.conflictIcon} />
        <div className={styles.conflictText}>
          <p className={styles.conflictTitle}>この紹介コードは、ほかの人が先に登録しました</p>
          <p className={styles.conflictNote}>入力は残っています。別の紹介コードに変えて保存してください</p>
        </div>
        <Button href={LIST_PATH}><List size={15} aria-hidden="true" /> 一覧で確かめる</Button>
      </div>
      ) : undefined}
      status={saving ? '登録しています' : partialSave ? '基本情報は保存済み・追加情報は未保存' : 'まだ保存していません'}
      footerActions={<>
        <Button href={LIST_PATH}>キャンセル</Button>
        <Button variant="secondary" disabled={saving} busy={saving} busyLabel="保存しています" onClick={() => void runSave('continue')}>
          {partialSave ? '追加情報の保存を再開する' : '保存して続けて作る'}
        </Button>
        <Button variant="primary" disabled={saving} busy={saving} busyLabel="登録しています" onClick={() => void runSave('finish')}>
          <Check size={15} aria-hidden="true" /> 登録して紹介リンクを発行する
        </Button>
      </>}
    >

      {partialSave && createdId ? (
        <Notice tone="warn" action={<a href={`${LIST_PATH}?affiliate=${encodeURIComponent(createdId)}&highlight=${encodeURIComponent(createdId)}`}>未保存の追加情報を破棄して一覧へ戻る</a>}>
          <p className={styles.noticeTitle}>基本情報は保存済みです</p>
          <p className={styles.noticeNote}>下の「追加情報の保存を再開する」で続けるか、未保存の追加情報を破棄して一覧へ戻れます。</p>
          <p className={styles.noticeNote}>
            {savedIsActive === true
              ? `基本情報の登録で計測は既に始まっています。${startTracking ? 'このまま追加情報だけを保存します。' : '再開するときは計測をオフに切り替えて保存します。'}`
              : savedIsActive === false
                ? `基本情報の登録は計測オフで済んでいるので、計測はまだ始まっていません。${startTracking ? '再開するときは計測をオンに切り替えて保存します。' : 'このまま追加情報だけを保存します。'}`
                : startTracking
                  ? '「すぐに計測を始める」がオンなので、基本情報の登録で計測は既に始まっています。'
                  : '「すぐに計測を始める」がオフなので、計測は始まらないまま追加情報だけを保存します。'}
          </p>
        </Notice>
      ) : null}

      <section className={styles.card} aria-label="だれを登録するか">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>だれを登録するか</h2>
          <p className={styles.cardNote}>会社でも個人でも登録できます</p>
        </div>
        <div className={styles.grid2}>
          <label className={styles.field} htmlFor="af-name">
            <span className={styles.label}>名前（表示名）</span>
            <TextField id="af-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例：ペットライフ編集部" maxLength={120} />
          </label>
          <label className={styles.field} htmlFor="af-code">
            <span className={styles.label}>
              紹介コード（リンクの最後に付く）
              <HelpTip label="紹介コードの決まり">登録後は変更できません。英数字4文字以上。空欄なら推測されにくいコードを自動で作ります。</HelpTip>
            </span>
            <TextField id="af-code" value={code} onChange={(event) => { setCode(event.target.value); setCodeConflict(false) }} placeholder="petlife2026" maxLength={64} />
          </label>
        </div>
        <label className={styles.field} htmlFor="af-email">
          <span className={styles.label}>連絡先メール</span>
          <TextField id="af-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="contact@example.com" maxLength={200} />
        </label>
        <div className={styles.friendRow}>
          <Button type="button" aria-expanded={friendPickerOpen} onClick={() => setFriendPickerOpen((open) => !open)}>
            <LinkIcon size={15} aria-hidden="true" /> LINE の友だちと結びつける
          </Button>
          <span className={styles.inlineNote}>
            {selectedFriend ? `結びつける友だち：${selectedFriend.displayName}` : '結びつけると、本人が LINE で成果を見られます'}
          </span>
        </div>
        {/* 閉じていても中身は置いておく（hidden）。開くと選んだ値・検索がそのまま残る。 */}
        <div className={styles.friendPicker} hidden={!friendPickerOpen}>
            {!selectedAccountId ? (
              <p className={styles.cardNote}>画面上部でLINEアカウントを選ぶと、友だちを検索できます。</p>
            ) : (
              <>
                <form
                  className={styles.friendSearch}
                  onSubmit={(event) => {
                    event.preventDefault()
                    setFriendPage(1)
                    setFriendSearch(friendSearchInput.trim())
                    setFriendReload((value) => value + 1)
                  }}
                >
                  <TextField aria-label="友だちの名前で検索" value={friendSearchInput} onChange={(event) => setFriendSearchInput(event.target.value)} placeholder="友だちの名前で探す" />
                  <Button type="submit">検索</Button>
                </form>
                <Select
                  id="af-friend"
                  aria-label="LINEの友だちと結びつける"
                  value={friendId}
                  size="full"
                  onChange={(nextId) => {
                    setFriendId(nextId)
                    setSelectedFriend(friendOptions.find((friend) => friend.id === nextId) ?? null)
                  }}
                  options={[
                    { value: '', label: friendLoading ? '読み込んでいます' : '結びつけない' },
                    ...friendOptions.map((friend) => ({ value: friend.id, label: friend.displayName })),
                  ]}
                />
                {friendError ? (
                  <div className={styles.friendSearch}>
                    <p className={styles.errorText}>{friendError}</p>
                    <Button type="button" onClick={() => setFriendReload((value) => value + 1)}>もう一度読み込む</Button>
                  </div>
                ) : (
                  <div className={styles.friendSearch}>
                    <p className={styles.cardNote}>{friendLoading ? '友だちを読み込んでいます' : `全${formatNumber(friendTotal)}件`}</p>
                    {friendPageCount > 1 ? (
                      <Select
                        id="af-friend-page"
                        aria-label="友だち候補のページ"
                        value={String(friendPage)}
                        onChange={(value) => setFriendPage(Number(value))}
                        disabled={friendLoading}
                        options={Array.from({ length: friendPageCount }, (_, index) => ({ value: String(index + 1), label: `${index + 1} / ${friendPageCount}ページ` }))}
                      />
                    ) : null}
                  </div>
                )}
              </>
            )}
        </div>
      </section>

      <section className={styles.card} aria-label="いくら払い、いつ締めるか">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>いくら払い、いつ締めるか</h2>
          <p className={styles.cardNote}>報酬の決め方は、案件ごとの額より先にこの人の決まりが使われます</p>
        </div>
        <RadioCardGroup legend="報酬の決め方" className={styles.choiceGrid}>
          {PAYOUT_KINDS.map((kind) => (
            <RadioCard
              key={kind.value}
              name="affiliate-payout-kind"
              value={kind.value}
              checked={payoutKind === kind.value}
              onChange={(value) => setPayoutKind(value as PayoutKind)}
              title={kind.label}
              note={kind.note}
              variant="compact"
              className={styles.choiceCard}
            />
          ))}
        </RadioCardGroup>
        {payoutKind === 'rate' ? (
          <label className={styles.field} htmlFor="af-rate">
            <span className={styles.label}>売上に対する割合（%）</span>
            <TextField id="af-rate" type="number" min={0} step="0.1" value={commissionRate} onChange={(event) => setCommissionRate(event.target.value)} placeholder="10" />
          </label>
        ) : null}
        <div className={styles.grid2}>
          <label className={styles.field} htmlFor="af-cycle">
            <span className={styles.label}>締めと支払い</span>
            <TextField id="af-cycle" value={payoutCycle} onChange={(event) => setPayoutCycle(event.target.value)} placeholder="例：月末締め・翌月末払い" maxLength={100} />
          </label>
          <div className={styles.field}>
            <span className={styles.label}>
              保留期間
              <HelpTip label="保留期間の意味">返品・キャンセルを待つ期間です。過ぎた成果が次の締めに入ります。</HelpTip>
            </span>
            <Select id="af-hold" aria-label="保留期間" size="full" value={holdDays} onChange={setHoldDays} options={holdOptions} />
          </div>
        </div>
      </section>

      <section className={styles.card} aria-label="成果が出たときにすること">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>成果が出たときにすること</h2>
          <p className={styles.cardNote}>任意</p>
        </div>
        <div className={styles.switchRow}>
          <Toggle checked={notifyOnConversion} label="本人に LINE で知らせる" onChange={setNotifyOnConversion} />
          <div className={styles.switchBody}>
            <p className={styles.switchName}>本人に LINE で知らせる</p>
            <p className={styles.switchNote}>成果 1 件ごとに</p>
          </div>
        </div>
        <div className={styles.switchRow}>
          <Toggle checked={startTracking} label="すぐに計測を始める" onChange={setStartTracking} />
          <div className={styles.switchBody}>
            <p className={styles.switchName}>すぐに計測を始める</p>
            <p className={styles.switchNoteFaint}>{startTracking ? '登録したらすぐに数え始めます' : 'オフでもリンクは発行されます'}</p>
          </div>
        </div>
      </section>

      {saveError ? <p className={styles.errorText} role="alert">{saveError}</p> : null}
      {saveNote ? <p className={styles.cardNote} role="status">{saveNote}</p> : null}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力したアフィリエイター" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </CreatePage>
  )
}
