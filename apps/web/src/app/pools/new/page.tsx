'use client'

import { useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'
import SelectField from '@/components/shared/select-field'

/** slug は URL に出る。日本語や記号を許すと /pool/xxx が壊れる。 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/

export default function NewPoolPage() {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [accountId, setAccountId] = useState('')
  const [accounts, setAccounts] = useState<LineAccount[]>([])

  useEffect(() => {
    void api.lineAccounts.list().then((res) => {
      if (res.success) {
        setAccounts(res.data)
        if (res.data.length > 0) setAccountId(res.data[0].id)
      }
    })
  }, [])

  return (
    <CreatePage
      title="プールを作る"
      description="複数のLINE公式アカウントをひとまとめにして、友だちの追加先を自動で振り分けます。"
      parent={['プール', '/pools']}
      validate={() => {
        if (!name.trim()) return '名前を入力してください'
        if (!SLUG_PATTERN.test(slug)) {
          return 'URLに使う名前は、半角英小文字・数字・ハイフンで2〜32文字にしてください'
        }
        if (!accountId) return '受け入れ先のアカウントを選んでください'
        return null
      }}
      onSave={async () => {
        const res = await api.pools.create({
          name: name.trim(),
          slug: slug.trim(),
          activeAccountId: accountId,
        })
        if (!res.success) throw new Error(res.error)
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
        note={
          <>
            半角英小文字・数字・ハイフンで2〜32文字。
            {slug && SLUG_PATTERN.test(slug) && (
              <>
                <br />
                友だち追加のURLは <code className="bg-canvas-sunken rounded px-1">/pool/{slug}</code>{' '}
                になります。
              </>
            )}
            <br />
            <strong>あとから変えられません。</strong>配ったURLが使えなくなるためです。
          </>
        }
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

      <Field
        label="いまの受け入れ先"
        htmlFor="pl-account"
        required
        note="友だち数が上限に近づいたら、ここを切り替えます。配ったURLはそのまま使えます。"
      >
        <SelectField
          id="pl-account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          aria-label="いまの受け入れ先"
          className={inputClass}
          options={accounts.map((account) => ({ value: account.id, label: account.name }))}
        />
      </Field>
    </CreatePage>
  )
}
