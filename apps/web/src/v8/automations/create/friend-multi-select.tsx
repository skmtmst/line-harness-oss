'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import { RequiredBadge } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import { api } from '@/lib/api'
import { FRIEND_SELECT_LIMIT, normalizeFriendIds } from './trigger-helpers'
import TruncatedText from '@/components/shared/truncated-text'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import FriendPickerField from '@/components/shared/friend-picker-field'
import Notice from '@/components/shared/notice'

export function FriendMultiSelect({
  accountId,
  selectedIds,
  names,
  onChange,
  error
}: {
  accountId: string | null
  selectedIds: ReadonlyArray<string>
  names: Record<string, string>
  onChange: (ids: string[], nextNames: Record<string, string>) => void
  error?: string
}) {
  const ids = normalizeFriendIds(selectedIds)
      return <SaveErrorField names={["query","search"]}><div>
      <p>
        対象の友だち（{ids.length} 人）<RequiredBadge />
      </p>
        <FriendPickerField label="対象の友だち" accountId={accountId} multiple
          value={ids} names={names}
          onChange={onChange} error={error} maxSelected={FRIEND_SELECT_LIMIT} /><p>100人まで選べます。
      </p>
    </div></SaveErrorField>
}
