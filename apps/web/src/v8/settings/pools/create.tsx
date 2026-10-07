'use client'

/*
 * ★V8-B プール管理「プールを作る」（Pencil `D0AOyx`・/pools/new）。
 *
 * 設定の板（中のメニューつき）の中に、左に「1. どのプールか」「2. いまの受け入れ先」の2枚、
 * 右に「プレビュー」。保存の帯は画面の下（キャンセル・保存してURLを発行）。
 * 動きは前の V8（app/pools/new/pool-new-v8.tsx。この画面に置き換えて消した）と同じ：LINEアカウントの一覧を読み（失敗は読み直しの口）、
 * 受け入れ先は複数・1件以上、URLに使う名前は半角英小文字・数字・ハイフンの2〜32文字、
 * 全部の受け入れ先を1回の保存で登録（落ちたらプールも所属も作られない・入力は残す）、作れたら一覧へ（作った行を目立たせる）。
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import type { LineAccount } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { createPageErrorMessage, createPageReturnHref } from '@/components/shared/create-page'
import { usePageTitle } from '@/components/shell/page-chrome'
import { api } from '@/lib/api'
import { SbSettingsScreen } from '../sb-frame/settings-screen'
import styles from './create.module.css'

/** slug は URL に出る。日本語や記号を許すと /pool/xxx が壊れる。 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/
const TITLE = 'プールを作る'
const DESCRIPTION = '複数の LINE 公式アカウントをひとまとめにして、友だちの追加先を自動で振り分けます。'
const LIST_HREF = '/pools'

function accountHandle(account: LineAccount): string | null {
  if (!account.basicId) return null
  return account.basicId.startsWith('@') ? account.basicId : `@${account.basicId}`
}

export default function PoolCreateV8() {
  usePageTitle(TITLE)
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  /** 受け入れ先（複数）。先頭が作るときの受け入れ先になる。 */
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerValue, setPickerValue] = useState('')
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [accountsError, setAccountsError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /* 一覧が取れないときに「0件」と見せない。失敗したことと読み直す口を出す。 */
  const loadAccounts = useCallback(async () => {
    setAccountsError('')
    try {
      const res = await api.lineAccounts.list()
      if (res.success) {
        setAccounts(res.data)
        if (res.data.length > 0) setAccountIds((current) => (current.length > 0 ? current : [res.data[0].id]))
      } else {
        setAccountsError('LINEアカウントを読み込めませんでした。もう一度お試しください。')
      }
    } catch {
      setAccountsError('LINEアカウントを読み込めませんでした。通信を確かめて、もう一度お試しください。')
    }
  }, [])

  useEffect(() => { void loadAccounts() }, [loadAccounts])

  const selectedAccounts = accountIds
    .map((id) => accounts.find((account) => account.id === id))
    .filter((account): account is LineAccount => Boolean(account))
  const addableAccounts = accounts.filter((account) => !accountIds.includes(account.id))
  const slugValid = SLUG_PATTERN.test(slug)
  const publicUrl = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/pool/${slugValid ? slug : 'shibuya'}`

  const addAccount = () => {
    if (!pickerValue) return
    setAccountIds((current) => (current.includes(pickerValue) ? current : [...current, pickerValue]))
    setPickerValue('')
    setPickerOpen(false)
  }

  const validate = (): string | null => {
    if (!name.trim()) return '名前を入力してください'
    if (!slugValid) return 'URLに使う名前は、半角英小文字・数字・ハイフンで2〜32文字にしてください'
    if (accountIds.length === 0) return '受け入れ先のアカウントを選んでください'
    return null
  }

  const save = async (event?: FormEvent) => {
    event?.preventDefault()
    if (saving) return
    const problem = validate()
    if (problem) { setError(problem); return }
    setSaving(true)
    setError('')
    try {
      const res = await api.pools.create({ name: name.trim(), slug: slug.trim(), activeAccountId: accountIds[0], accountIds })
      if (!res.success) throw new Error(res.error)
      router.push(createPageReturnHref(LIST_HREF, res.data.id))
    } catch (e) {
      setError(createPageErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SbSettingsScreen
      boardId="D0AOyx"
      layout="narrow-nav"
      title={TITLE}
      description={DESCRIPTION}
      saveActions={(
        <>
          <Button href={LIST_HREF}>キャンセル</Button>
          <Button variant="primary" type="submit" form="pool-create-form" busy={saving} busyLabel="保存しています…" disabled={saving}>
            <Check className={styles.btnIcon} aria-hidden="true" />保存してURLを発行
          </Button>
        </>
      )}
    >
      <form id="pool-create-form" className={styles.columns} onSubmit={(event) => void save(event)} noValidate>
        <div className={styles.main}>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          <section className={styles.card} aria-labelledby="pool-create-what">
            <h2 id="pool-create-what" className={styles.cardTitle}>1. どのプールか</h2>
            <label className={styles.field} htmlFor="pl-name">
              <span className={styles.label}>プール名</span>
              <TextField id="pl-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例: 渋谷エリア" maxLength={100} />
            </label>
            <label className={styles.field} htmlFor="pl-slug">
              <span className={styles.label}>URLに使う名前（あとから変えられません）</span>
              <TextField id="pl-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="shibuya" maxLength={32} />
            </label>
            <p className={styles.hint}>
              {slugValid
                ? `保存すると、このURLが発行されます：${publicUrl}`
                : '半角英小文字・数字・ハイフンで2〜32文字。配ったURLが使えなくなるため、あとから変えられません。'}
            </p>
          </section>

          <section className={styles.card} aria-labelledby="pool-create-where">
            <div className={styles.cardHead}>
              <h2 id="pool-create-where" className={styles.cardTitle}>2. いまの受け入れ先</h2>
              <p className={styles.cardSub}>友だちが開く追加先と、現在の受け入れ先です</p>
            </div>
            {selectedAccounts.map((account) => (
              <div key={account.id} className={styles.account}>
                <span className={styles.accountName} title={account.name}>{account.name}</span>
                {accountHandle(account) ? <span className={styles.accountSub}>{accountHandle(account)}</span> : null}
                <span className={styles.spacer} />
                <Button
                  type="button"
                  onClick={() => setAccountIds((current) => current.filter((id) => id !== account.id))}
                  disabled={accountIds.length <= 1}
                  title={accountIds.length <= 1 ? '受け入れ先は1件以上必要です' : `${account.name}を外す`}
                >
                  外す
                </Button>
              </div>
            ))}
            {pickerOpen ? (
              <div className={styles.picker}>
                <span className={styles.pickerSelect}>
                  <Select value={pickerValue} onChange={setPickerValue} aria-label="足すアカウント" size="full" options={addableAccounts.map((account) => ({ value: account.id, label: account.name }))} />
                </span>
                <Button type="button" onClick={addAccount} disabled={!pickerValue}>追加</Button>
              </div>
            ) : (
              <span className={styles.addRow}>
                <Button type="button" onClick={() => setPickerOpen(true)} disabled={addableAccounts.length === 0}>＋ アカウントを足す</Button>
              </span>
            )}
            {accountsError ? (
              <p role="alert" className={styles.error}>
                {accountsError}{' '}
                <button type="button" className={styles.retry} onClick={() => void loadAccounts()}>再読み込み</button>
              </p>
            ) : null}
          </section>
        </div>

        <aside className={styles.side} aria-label="プレビュー">
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>プレビュー</h2>
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>友だち追加URL</dt>
                <dd>{slugValid ? publicUrl : 'まだURLは発行されていません。「URLに使う名前」を入れて保存すると、正式なURLが発行されます。'}</dd>
              </div>
              <div className={styles.fact}>
                <dt>現在の受け入れ先</dt>
                <dd>{selectedAccounts.length > 0 ? `${selectedAccounts.map((account) => account.name).join('・')}（稼働中の所属先からランダムに振り分け）` : '未選択'}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </form>
    </SbSettingsScreen>
  )
}
