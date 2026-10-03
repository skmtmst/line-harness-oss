'use client'

/*
 * ★V8-B プール管理の「プールを作る」（板 `D0AOyx`）。
 *
 * v7 の作る画面（`page.tsx`）とは別の部品として持つ。同じ口で作る。
 * 違いは置き場と見せ方だけ——1. どのプールか／2. いまの受け入れ先の
 * 番号つきの節、右にプレビュー、下に追従する帯。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 *
 * 作るときに受け入れ先を複数選べる。口は1件ずつしか足せないので、
 * 先頭でプールを作ってから残りを1件ずつ足す。途中で落ちた分は
 * 名前を挙げて伝え、一覧から足し直せるようにする（部分失敗の決まり）。
 */

import { useCallback, useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'
import { usePageTitle } from '@/components/shell/page-chrome'

/** slug は URL に出る。日本語や記号を許すと /pool/xxx が壊れる。 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/

export default function PoolNewV8() {
  usePageTitle('プールを作る')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  /** 受け入れ先（複数）。先頭が作るときの受け入れ先になる。 */
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerValue, setPickerValue] = useState('')
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [accountsError, setAccountsError] = useState('')

  /**
   * 受け入れ先の一覧。取れなかったときに「アカウントが0件」と
   * 見せると選びようがないので、失敗したことと読み直す口を出す。
   */
  const loadAccounts = useCallback(async () => {
    setAccountsError('')
    try {
      const res = await api.lineAccounts.list()
      if (res.success) {
        setAccounts(res.data)
        // 既に選んだあと（再読み込み）なら、その選択を上書きしない。
        if (res.data.length > 0) setAccountIds((current) => (current.length > 0 ? current : [res.data[0].id]))
      } else {
        setAccountsError('LINEアカウントを読み込めませんでした。もう一度お試しください。')
      }
    } catch {
      setAccountsError('LINEアカウントを読み込めませんでした。通信を確かめて、もう一度お試しください。')
    }
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  const selectedAccounts = accountIds
    .map((id) => accounts.find((account) => account.id === id))
    .filter((account): account is LineAccount => Boolean(account))
  const addableAccounts = accounts.filter((account) => !accountIds.includes(account.id))

  const removeAccount = (id: string) => {
    setAccountIds((current) => current.filter((item) => item !== id))
  }

  const addAccount = () => {
    if (!pickerValue) return
    setAccountIds((current) => (current.includes(pickerValue) ? current : [...current, pickerValue]))
    setPickerValue('')
    setPickerOpen(false)
  }

  return (
    <CreatePage
      title="プールを作る"
      description="複数のLINE公式アカウントをひとまとめにして、友だちの追加先を自動で振り分けます。"
      showHeader={false}
      parent={['プール', '/pools']}
      variant="v6"
      designNode="D0AOyx"
      saveLabel="保存してURLを発行"
      aside={(
        <section className="bg-canvas border-hairline rounded-card border p-5 shadow-card">
          <h2 className="text-ink text-base font-bold">プレビュー</h2>
          <p className="text-ink-faint mt-1 text-xs">友だちが開く追加先と、現在の受け入れ先です。</p>
          <div className="bg-canvas-sunken rounded-control mt-4 p-4">
            <p className="text-ink-faint text-xs">友だち追加URL</p>
            {slug && SLUG_PATTERN.test(slug) ? (
              <>
                <code className="text-ink mt-1 block break-all text-sm">/pool/{slug}</code>
                <p className="text-ink-faint mt-1 text-xs">保存すると、このURLが発行されます。</p>
              </>
            ) : (
              <>
                {/* #975 U066: 未入力でも実URLに見える表示をしない。例と明記する。 */}
                <code className="text-ink-faint mt-1 block break-all text-sm">例: /pool/shibuya</code>
                <p className="text-ink-faint mt-1 text-xs">まだURLは発行されていません。「URLに使う名前」を入れて保存すると、正式なURLが発行されます。</p>
              </>
            )}
            <p className="text-ink-faint mt-4 text-xs">現在の受け入れ先</p>
            {selectedAccounts.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {selectedAccounts.map((account) => (
                  <li key={account.id} className="text-ink text-sm font-semibold">{account.name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-faint mt-1 text-sm">未選択</p>
            )}
            <p className="text-ink-faint mt-1 text-xs">稼働中の所属先からランダムに振り分け</p>
          </div>
        </section>
      )}
      validate={() => {
        if (!name.trim()) return '名前を入力してください'
        if (!SLUG_PATTERN.test(slug)) {
          return 'URLに使う名前は、半角英小文字・数字・ハイフンで2〜32文字にしてください'
        }
        if (accountIds.length === 0) return '受け入れ先のアカウントを選んでください'
        return null
      }}
      onSave={async () => {
        const res = await api.pools.create({
          name: name.trim(),
          slug: slug.trim(),
          activeAccountId: accountIds[0],
        })
        if (!res.success) throw new Error(res.error)
        // 2件目以降は1件ずつ足す。落ちた分は名前を挙げて伝え、足し直せるようにする。
        const failed: string[] = []
        for (const accountId of accountIds.slice(1)) {
          const added = await api.pools.accounts.add(res.data.id, accountId)
          if (!added.success) {
            failed.push(accounts.find((account) => account.id === accountId)?.name ?? '名前の分からないアカウント')
          }
        }
        if (failed.length > 0) {
          throw new Error(`プールは作りましたが、${failed.join('・')}の追加に失敗しました。一覧からプールを開き、受け入れ先を足し直してください。`)
        }
        return res.data.id
      }}
    >
      <p className="text-ink text-sm font-semibold">1. どのプールか</p>

      <Field label="プール名" htmlFor="pl-name" required>
        <input
          id="pl-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 渋谷エリア"
          className={inputClass}
        />
      </Field>

      <Field
        label="URLに使う名前"
        htmlFor="pl-slug"
        required
        note={(
          <>
            半角英小文字・数字・ハイフンで2〜32文字。
            {slug && SLUG_PATTERN.test(slug) && (
              <>
                <br />
                友だち追加のURLは <code className="bg-canvas-sunken rounded-mini px-1">/pool/{slug}</code>{' '}
                になります。
              </>
            )}
            <br />
            <strong>あとから変えられません。</strong>配ったURLが使えなくなるためです。
          </>
        )}
      >
        <input
          id="pl-slug"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="shibuya"
          className={`${inputClass} font-mono`}
        />
      </Field>

      <p className="text-ink text-sm font-semibold">2. いまの受け入れ先</p>
      <p className="text-ink-faint text-xs">友だちが開く追加先と、現在の受け入れ先です</p>
      {selectedAccounts.map((account) => (
        <div key={account.id} className="border-hairline rounded-control mt-2 flex items-center justify-between gap-2 border px-3 py-2">
          <span className="text-ink min-w-0 truncate text-sm font-medium">{account.name}</span>
          <Button
            type="button"
            variant="secondary"
            size="compact"
            onClick={() => removeAccount(account.id)}
            disabled={accountIds.length <= 1}
            title={accountIds.length <= 1 ? '受け入れ先は1件以上必要です' : `${account.name}を外す`}
          >
            外す
          </Button>
        </div>
      ))}
      {pickerOpen ? (
        <div className="mt-2 flex items-center gap-2">
          <Select
            value={pickerValue}
            onChange={setPickerValue}
            aria-label="足すアカウント"
            size="full"
            options={addableAccounts.map((account) => ({ value: account.id, label: account.name }))}
          />
          <Button type="button" variant="secondary" onClick={addAccount} disabled={!pickerValue}>
            追加
          </Button>
        </div>
      ) : (
        <div className="mt-2">
          <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)} disabled={addableAccounts.length === 0}>
            ＋ アカウントを足す
          </Button>
        </div>
      )}
      {accountsError && (
        <p className="text-danger mt-1 text-xs">
          {accountsError}{' '}
          <button
            type="button"
            onClick={() => void loadAccounts()}
            className="underline"
          >再読み込み
          </button>
        </p>
      )}
    </CreatePage>
  )
}
