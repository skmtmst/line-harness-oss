'use client'

import { useState } from 'react'
import { bookingApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

export default function NewBookingStaffPage() {
  const { selectedAccountId } = useAccount()
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [isDesignationOptional, setIsDesignationOptional] = useState(false)

  return (
    <CreatePage
      title="予約スタッフを登録する"
      description="お客様が指名できる担当者です。"
      parent={['予約設定', '/booking/menus?tab=staff']}
      validate={() => {
        if (!selectedAccountId) return '先に上部でLINEアカウントを選んでください'
        if (!name.trim()) return '名前を入力してください'
        return null
      }}
      onReset={() => {
        setName('')
        setDisplayName('')
      }}
      onSave={async () => {
        const res = await bookingApi.createStaff(selectedAccountId!, {
          name: name.trim(),
          display_name: displayName.trim() || name.trim(),
          is_designation_optional: isDesignationOptional ? 1 : 0,
        })
        return res.id
      }}
    >
      <Field label="名前" htmlFor="bs-name" required note="管理画面での呼び名です。">
        <input
          id="bs-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field
        label="お客様に見せる名前"
        htmlFor="bs-display"
        note="空欄なら上の名前をそのまま使います。"
      >
        <input
          id="bs-display"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={inputClass}
        />
      </Field>

      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={isDesignationOptional}
          onChange={(e) => setIsDesignationOptional(e.target.checked)}
          className="mt-0.5 rounded border-gray-300"
        />
        <span className="text-ink-secondary text-sm">
          「指名なし」の受け皿にする
          <span className="text-ink-faint block text-xs">
            お客様が担当を選ばなかったときに、この人へ割り当てます。
          </span>
        </span>
      </label>

      <p className="text-ink-faint text-xs leading-relaxed">
        登録したあと、担当できるメニューと受付時間を設定してください。
        どちらかが空だと、お客様の画面に空き枠が出ません。
      </p>
    </CreatePage>
  )
}
