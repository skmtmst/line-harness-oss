'use client'

const checks = [
  { label: '13文字以上', test: (value: string) => value.length >= 13 },
  { label: '英大文字を1文字以上', test: (value: string) => /[A-Z]/.test(value) },
  { label: '英小文字を1文字以上', test: (value: string) => /[a-z]/.test(value) },
  { label: '数字を1文字以上', test: (value: string) => /[0-9]/.test(value) },
  { label: '特殊記号を1文字以上', test: (value: string) => /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(value) },
]

export default function PasswordRequirements({ value }: { value: string }) {
  return <div className="w-full rounded-control bg-surface-pearl px-3 py-2 text-micro text-ink-secondary" aria-label="パスワードの条件">
    <p className="mb-1 font-semibold">パスワードの条件</p>
    <ul className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
      {checks.map(({ label, test }) => {
        const passed = test(value)
        return <li key={label} className={passed ? 'text-accent-deep' : undefined}>
          <span aria-hidden="true">{passed ? '✓' : '○'}</span> {label}
        </li>
      })}
    </ul>
  </div>
}
