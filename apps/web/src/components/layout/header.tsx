import React from 'react'

interface HeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

export default function Header({ title, description, action }: HeaderProps) {
  return (
    <div className="mb-8">
      {/*
        操作ボタンは以前 `shrink-0 ml-4` で右端へ固定していた。題の長い画面
        （「友だち追加時の配信」「メニューのエリアを編集する」など）を狭い幅で
        開くと、題が折り返せずボタンだけが潰れる。折り返しを許して、
        入りきらないときはボタンが次の行へ落ちるようにする。
      */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-ink text-2xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="text-ink-secondary mt-1 text-sm">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}
