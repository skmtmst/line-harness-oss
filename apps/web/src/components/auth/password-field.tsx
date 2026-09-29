'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { TextField } from '@/components/shared/text-field'

/** パスワードの入力欄。右端の目の印で表示と非表示を切り替える（設計の「表示切替」）。 */
export default function PasswordField({
  id,
  value,
  onChange,
  invalid,
  autoComplete,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  autoComplete: 'current-password' | 'new-password'
  placeholder?: string
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative w-full">
      <TextField
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        invalid={invalid}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-describedby={invalid ? `${id}-error` : undefined}
        style={{ paddingRight: 40 }}
      />
      <button
        type="button"
        onClick={() => setShown((current) => !current)}
        aria-label={shown ? 'パスワードを隠す' : 'パスワードを表示する'}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-faint hover:text-ink"
      >
        {shown ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
      </button>
    </div>
  )
}
