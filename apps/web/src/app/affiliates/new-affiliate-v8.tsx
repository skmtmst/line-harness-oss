'use client'

/*
 * ★V8-B アフィリエイターを作る（板 `RaMf3`）。
 *
 * v7（new/page.tsx の器）とは別の器。データの口・動きは v7 と同じ
 * （登録・追加情報の保存・紹介リンク・友だち結び・離脱の番兵）。
 * 紹介URLは伏せ字にせず、省略とコピーで出す。
 * 変える操作は器の外（共通の部品・API）へ触らない。
 * v7 を直す必要が出たら new/page.tsx 側も同じ判断を入れる。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Link as LinkIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { Friend } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { TextField } from '@/components/shared/text-field'
import Button from '@/components/shared/button'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import HelpTip from '@/components/shared/help-tip'
import Disclosure from '@/components/shared/disclosure'
import Toggle from '@/components/shared/toggle'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import Notice from '@/components/shared/notice'
import { formatNumber } from '@/lib/format'
import styles from './create-v8.module.css'

const FRIEND_PAGE_SIZE = 20
const AFFILIATE_LIST_PATH = '/conversions?tab=affiliates'

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
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return '売上に対する割合は0から100の間で入力してください'
  }
  return null
}

type PayoutKind = 'per_conversion' | 'rate' | 'none'

const PAYOUT_KINDS: Array<{ value: PayoutKind; label: string; note: string }> = [
  { value: 'none', label: '報酬なし（計測のみ）', note: '成果の件数だけを記録' },
  { value: 'rate', label: '売上に対する割合', note: '注文金額の ◯% を報酬に' },
  { value: 'per_conversion', label: '成果1件ごとに定額', note: '金額は案件の「報酬額」で' },
]

export function NewAffiliateV8() {
  usePageTitle('アフィリエイターを作る')
  const router = useRouter()
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
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [partialSave, setPartialSave] = useState(false)
  const [savedIsActive, setSavedIsActive] = useState<boolean | null>(null)
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveNote, setSaveNote] = useState('')
  /**
   * Gqve5 の競合の帯。紹介コードの重なり（409）は、ほかの人が先に
   * 同じコードで登録したときに起きる。入力は残し、帯から一覧を
   * 確かめられる。誰が・いつ保存したかは API が返さないので出さない。
   */
  const [codeConflict, setCodeConflict] = useState(false)
  const [friendPickerOpen, setFriendPickerOpen] = useState(false)

  const draftAccountRef = useRef(selectedAccountId)
  useEffect(() => {
    if (draftAccountRef.current === selectedAccountId) return
    draftAccountRef.current = selectedAccountId
    setCreatedId(null)
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

  const validate = (): string | null => {
    if (!selectedAccountId) return 'LINEアカウントを選んでください（画面上部で選べます）'
    if (!name.trim()) return '名前・屋号を入力してください'
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
    setPartialSave(false)
    setSavedIsActive(null)
    setOperationId(crypto.randomUUID())
  }

  const save = async (): Promise<string> => {
    if (!selectedAccountId) {
      throw new Error('LINEアカウントを選んでください（画面上部で選べます）')
    }
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
          lineAccountId: selectedAccountId,
          operationId,
          isActive: startTracking,
        })
        if (!res.success) {
          const serverMessage = res.error ?? ''
          if (serverMessage.includes('既に使われています')) {
            setCodeConflict(true)
            throw new Error(`${serverMessage}。ほかの人が先に登録した可能性があります。`)
          }
          throw new Error('create_failed')
        }
        affiliateId = res.data.id
        setCreatedId(affiliateId)
        const persistedIsActive =
          typeof res.data.isActive === 'boolean' ? res.data.isActive : startTracking
        setStartTracking(persistedIsActive)
        setSavedIsActive(persistedIsActive)
      } catch {
        throw new Error('アフィリエイターを登録できませんでした。入力を確認して、もう一度お試しください。')
      }
    }
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
        router.push(`${AFFILIATE_LIST_PATH}&highlight=${encodeURIComponent(affiliateId)}`)
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

  return (
    <div data-design-node="RaMf3" className={styles.board}>
      <div className={styles.head}>
        <Link href="/affiliates" className={styles.backLink}>← 成果とアフィリエイトへ</Link>
        <h1 className={styles.headTitle}>アフィリエイターを作る</h1>
        <p className={styles.headDescription}>登録すると紹介リンクができます。成果はその人の紹介リンクから来た人で数えます。</p>
      </div>

      {codeConflict ? (
        <Notice
          tone="warn"
          action={(
            <a href={AFFILIATE_LIST_PATH}>
              一覧で確かめる
            </a>
          )}
        >
          <p className={styles.cardTitle}>この紹介コードは既に使われています</p>
          <p className={styles.cardNote}>
            ほかの人が先に登録した可能性があります。このまま保存しても登録できません。コードを変えて続けるか、一覧で確かめてください。
          </p>
        </Notice>
      ) : null}

      {partialSave && createdId ? (
        <Notice
          tone="warn"
          action={(
            <a href={`${AFFILIATE_LIST_PATH}&highlight=${encodeURIComponent(createdId)}`}>
              未保存の追加情報を破棄して一覧へ戻る
            </a>
          )}
        >
          <p className={styles.cardTitle}>基本情報は保存済みです</p>
          <p className={styles.cardNote}>
            下の「追加情報の保存を再開する」で続けるか、未保存の追加情報を破棄して一覧へ戻れます。
          </p>
          {savedIsActive === true ? (
            <p className={styles.cardNote}>
              基本情報の登録で計測は既に始まっています。
              {startTracking
                ? 'このまま追加情報だけを保存します。'
                : '再開するときは計測をオフに切り替えて保存します。'}
            </p>
          ) : savedIsActive === false ? (
            <p className={styles.cardNote}>
              基本情報の登録は計測オフで済んでいるので、計測はまだ始まっていません。
              {startTracking
                ? '再開するときは計測をオンに切り替えて保存します。'
                : 'このまま追加情報だけを保存します。'}
            </p>
          ) : (
            <p className={styles.cardNote}>
              {startTracking
                ? '「すぐに計測を始める」がオンなので、基本情報の登録で計測は既に始まっています。'
                : '「すぐに計測を始める」がオフなので、計測は始まらないまま追加情報だけを保存します。'}
            </p>
          )}
        </Notice>
      ) : null}

      <div className={styles.columns}>
        <div className={styles.main}>
          <section className={styles.card} aria-label="だれを登録するか">
            <h2 className={styles.cardTitle}>だれを登録するか</h2>
            <p className={styles.cardNote}>会社でも個人でも登録できます</p>
            <div className={styles.grid2}>
              <label className={styles.fieldLabel} htmlFor="af-name">
                名前（表示名）
                <TextField
                  id="af-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例：ペットライフ編集部"
                  maxLength={120}
                />
              </label>
              <label className={styles.fieldLabel} htmlFor="af-code">
                <span className={styles.toolbar}>紹介コード（リンクの最後に付く）<HelpTip label="紹介コードの決まり">登録後は変更できません。英数字4文字以上。空欄なら推測されにくいコードを自動で作ります。</HelpTip></span>
                <TextField
                  id="af-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="petlife2026"
                  maxLength={64}
                />
              </label>
            </div>
            <label className={styles.fieldLabel} htmlFor="af-email">
              連絡先メール
              <TextField
                id="af-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="contact@example.com"
                maxLength={200}
              />
            </label>
            <div>
              <div className={styles.toolbar}>
                <Button type="button" variant="secondary" aria-expanded={friendPickerOpen} onClick={() => setFriendPickerOpen((open) => !open)}>
                  <LinkIcon size={15} aria-hidden="true" /> LINE の友だちと結びつける
                </Button>
                <HelpTip label="友だちとの紐付け">選択中のLINEアカウントの友だちを検索できます。結びつけると、本人がLINEで成果を見られます。</HelpTip>
                {selectedFriend ? <span>{selectedFriend.displayName}</span> : null}
              </div>
              <div hidden={!friendPickerOpen}>
              {!selectedAccountId ? (
                <p className={styles.cardNote}>画面上部でLINEアカウントを選ぶと、友だちを検索できます。</p>
              ) : (
                <>
                  <form
                    className={styles.toolbar}
                    onSubmit={(event) => {
                      event.preventDefault()
                      setFriendPage(1)
                      setFriendSearch(friendSearchInput.trim())
                      setFriendReload((value) => value + 1)
                    }}
                  >
                    <TextField
                      aria-label="友だちの名前で検索"
                      value={friendSearchInput}
                      onChange={(event) => setFriendSearchInput(event.target.value)}
                      placeholder="友だちの名前で探す"
                    />
                    <Button type="submit" variant="secondary" size="compact">検索</Button>
                  </form>
                  <Select
                    id="af-friend"
                    aria-label="LINEの友だちと結びつける"
                    value={friendId}
                    onChange={(nextId) => {
                      setFriendId(nextId)
                      setSelectedFriend(friendOptions.find((friend) => friend.id === nextId) ?? null)
                    }}
                    options={[
                      { value: '', label: friendLoading ? '読み込んでいます' : '結びつけない' },
                      ...friendOptions.map((friend) => ({ value: friend.id, label: friend.displayName })),
                    ]}
                    size="standard"
                  />
                  {friendError ? (
                    <div className={styles.toolbar}>
                      <p className={styles.errorText}>{friendError}</p>
                      <Button type="button" variant="secondary" size="compact" onClick={() => setFriendReload((value) => value + 1)}>
                        もう一度読み込む
                      </Button>
                    </div>
                  ) : (
                    <div className={styles.toolbar}>
                      <p className={styles.footnote}>
                        {friendLoading ? '友だちを読み込んでいます' : `全${formatNumber(friendTotal)}件`}
                      </p>
                      {friendPageCount > 1 ? (
                        <Select
                          id="af-friend-page"
                          aria-label="友だち候補のページ"
                          value={String(friendPage)}
                          onChange={(value) => setFriendPage(Number(value))}
                          disabled={friendLoading}
                          options={Array.from({ length: friendPageCount }, (_, index) => ({
                            value: String(index + 1),
                            label: `${index + 1} / ${friendPageCount}ページ`,
                          }))}
                          size="standard"
                        />
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </div>
              </div>
          </section>

          <section className={styles.card} aria-label="いくら払い、いつ締めるか">
            <h2 className={styles.cardTitle}>いくら払い、いつ締めるか</h2>
            <p className={styles.cardNote}>報酬の決め方は、案件ごとの額より先にこの人の決まりが使われます</p>
            <RadioCardGroup legend="報酬の決め方" className={styles.choiceGrid}>
              {[...PAYOUT_KINDS].reverse().map((kind) => (
                <RadioCard key={kind.value} name="affiliate-payout-kind" value={kind.value}
                  checked={payoutKind === kind.value} onChange={(value) => setPayoutKind(value as PayoutKind)}
                  title={kind.label} note={kind.note} />
              ))}
            </RadioCardGroup>
            {payoutKind === 'rate' ? (
              <label className={styles.fieldLabel} htmlFor="af-rate">
                売上に対する割合
                <span className={styles.toolbar}>
                  <TextField
                    id="af-rate"
                    type="number"
                    min={0}
                    step="0.1"
                    value={commissionRate}
                    onChange={(event) => setCommissionRate(event.target.value)}
                    placeholder="10"
                  />
                  <span className={styles.footnote}>%</span>
                </span>
              </label>
            ) : null}
            <div className={styles.grid2}>
              <label className={styles.fieldLabel} htmlFor="af-cycle">
                締めと支払い
                <TextField
                  id="af-cycle"
                  value={payoutCycle}
                  onChange={(event) => setPayoutCycle(event.target.value)}
                  placeholder="例：月末締め翌月末払い"
                  maxLength={100}
                />
              </label>
              <label className={styles.fieldLabel} htmlFor="af-hold">
                <span className={styles.toolbar}>保留期間<HelpTip label="保留期間の意味">返品・キャンセルを考慮する期間です。</HelpTip></span>
                <span className={styles.toolbar}>
                  <TextField
                    id="af-hold"
                    type="number"
                    min={0}
                    max={365}
                    value={holdDays}
                    onChange={(event) => setHoldDays(event.target.value)}
                  />
                  <span className={styles.footnote}>日（取り消しを待つ）</span>
                </span>
              </label>
            </div>
          </section>

          <section className={styles.card} aria-label="成果が出たときにすること">
            <h2 className={styles.cardTitle}>成果が出たときにすること</h2>
            <p className={styles.cardNote}>任意</p>
            <div className={styles.switchRow}>
              <Toggle checked={notifyOnConversion} label="本人にLINEで知らせる" onChange={setNotifyOnConversion} />
              <div className={styles.switchBody}>
                <p className={styles.switchName}>本人にLINEで知らせる</p>
                <p className={styles.switchNote}>成果1件ごとに</p>
              </div>
            </div>
            <Disclosure title="計測の開始" hint={startTracking ? "登録後すぐに開始" : "開始しない"} size="compact">
            <div className={styles.switchRow}>
              <Toggle checked={startTracking} label="すぐに計測を始める" onChange={setStartTracking} />
              <div className={styles.switchBody}>
                <p className={styles.switchName}>すぐに計測を始める</p>
                <p className={styles.switchNote}>オフでもリンクは発行されます</p>
              </div>
            </div>
            </Disclosure>
          </section>

          {saveError ? <p className={styles.errorText} role="alert">{saveError}</p> : null}
          {saveNote ? <p className={styles.footnote} role="status">{saveNote}</p> : null}
        </div>

        <aside className={styles.rail} aria-label="登録の確認">
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>できる紹介リンク</h2>
            <p className={styles.cardNote}>登録すると発行されます</p>
            <dl className={styles.kvList}>
              <div className={styles.kvRow}>
                <dt className={styles.kvKey}>リンク</dt>
                <dd className={styles.kvValue}>
                  {previewUrl ? (
                    <span className={styles.urlRow}>
                      <span className={styles.urlText} title={previewUrl}>{previewUrl}</span>
                      <Button
                        variant="secondary"
                        size="compact"
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(previewUrl).then(
                            () => setCopied(true),
                            () => setCopied(false),
                          )
                        }}
                      >
                        コピー
                      </Button>
                    </span>
                  ) : '—'}
                </dd>
              </div>
              <div className={styles.kvRow}>
                <dt className={styles.kvKey}>報酬</dt>
                <dd className={styles.kvValue}>
                  {payoutKind === 'none' ? '計測のみ' : payoutKind === 'rate' ? '売上の割合' : '1件ごと（案件の額）'}
                </dd>
              </div>
              <div className={styles.kvRow}>
                <dt className={styles.kvKey}>締め</dt>
                <dd className={styles.kvValue}>{payoutCycle.trim() || '—'}</dd>
              </div>
            </dl>
            <p className={styles.footnote}>
              {previewUrl
                ? copied
                  ? 'コピーしました。保存すると、このURLで確定します。'
                  : '保存すると、このURLで確定します。'
                : '紹介コードを空欄のままにすると、保存したときに自動で決まります。決まる前のURLはコピーできません。'}
            </p>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>気をつけること</h2>
            <ul className={styles.noteList}>
              <li>紹介コードはあとから変えられません（配ったリンクが動かなくなるため）</li>
              <li>報酬を払う人は、振込先の登録が必要です</li>
            </ul>
          </section>
        </aside>
      </div>

      <StickyBar
        status={saving ? '登録しています' : partialSave ? '基本情報は保存済み・追加情報は未保存' : 'まだ保存していません'}
        actions={(
          <>
            <Button href="/affiliates">キャンセル</Button>
            <Button
              variant="secondary"
              disabled={saving}
              busy={saving}
              busyLabel="保存中..."
              onClick={() => void runSave('continue')}
            >
              {partialSave ? '追加情報の保存を再開する' : '保存して続けて作る'}
            </Button>
            <Button
              variant="primary"
              disabled={saving}
              busy={saving}
              busyLabel="登録中..."
              onClick={() => void runSave('finish')}
            >
              <Check size={15} aria-hidden="true" /> 登録して紹介リンクを発行する
            </Button>
          </>
        )}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力したアフィリエイター" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
