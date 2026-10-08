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
import { Field } from '@/components/shared/form-controls'
import { createPageErrorMessage, createPageReturnHref } from '@/components/shared/create-page'
import { usePageTitle } from '@/components/shell/page-chrome'
import { api } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
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
  const [inputError, setInputError] = useState<{ target: string; message: string } | null>(null)

  useEffect(() => {
    if (!inputError) return
    const control = document.getElementById(inputError.target)
    control?.focus()
    control?.scrollIntoView?.({ block: 'center' })
  }, [inputError])

  const guard = useUnsavedGuard({
    dirty: name !== '' || slug !== '' || (accounts.length > 0 && accountIds.join(',') !== accounts[0].id),
    busy: saving,
  })

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

  const validate = (): { target: string; message: string } | null => {
    if (!name.trim()) return { target: 'pl-name', message: '名前を入力してください' }
    if (!slugValid) return { target: 'pl-slug', message: 'URLに使う名前は、半角英小文字・数字・ハイフンで2〜32文字にしてください' }
    if (accountIds.length === 0) return { target: 'pl-add-account', message: '受け入れ先のアカウントを選んでください' }
    return null
  }

  const save = async (event?: FormEvent) => {
    event?.preventDefault()
    if (saving) return
    const problem = validate()
    setError('')
    if (problem) { setInputError(problem); return }
    setInputError(null)
    setSaving(true)
    setError('')
    try {
      const res = await api.pools.create({ name: name.trim(), slug: slug.trim(), activeAccountId: accountIds[0], accountIds })
      if (!res.success) throw new Error(res.error)
      guard.disarm()
      router.push(createPageReturnHref(LIST_HREF, res.data.id))
    } catch (e) {
      setError(createPageErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    <SbSettingsScreen
      boardId="D0AOyx"
      layout="narrow-nav"
      title={TITLE}
      description={DESCRIPTION}
      savePlacement="content"
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
            <Field label="プール名" htmlFor="pl-name" error={inputError?.target === 'pl-name' ? inputError.message : undefined}>
              <TextField id="pl-name" value={name} onChange={(event) => { setName(event.target.value); if (inputError?.target === 'pl-name') setInputError(null) }} placeholder="例: 渋谷エリア" maxLength={100} />
            </Field>
            <Field label="URLに使う名前（あとから変えられません）" htmlFor="pl-slug" error={inputError?.target === 'pl-slug' ? inputError.message : undefined}>
              <TextField id="pl-slug" value={slug} onChange={(event) => { setSlug(event.target.value); if (inputError?.target === 'pl-slug') setInputError(null) }} placeholder="shibuya" maxLength={32} />
            </Field>
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
                <Button id="pl-add-account" type="button" onClick={() => { setInputError(null); setPickerOpen(true) }} disabled={addableAccounts.length === 0}>＋ アカウントを足す</Button>
              </span>
            )}
            {inputError?.target === 'pl-add-account' ? <p className={styles.error} role="alert">{inputError.message}</p> : null}
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
    <UnsavedLeaveDialog open={guard.leaveTarget !== null} subject="入力したプールの内容" busy={saving} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
    </>
  )
}
