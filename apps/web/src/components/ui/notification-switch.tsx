'use client'

type NotificationSwitchProps = {
  checked: boolean
  label: string
  onChange: () => void
}

export default function NotificationSwitch({ checked, label, onChange }: NotificationSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-5 w-[34px] shrink-0 cursor-pointer overflow-hidden rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-hairline'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[14px]' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
