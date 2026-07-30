import React from 'react'

interface HeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

export default function Header({ title, description, action }: HeaderProps) {
  return (
    <div className="mb-5 sm:mb-8">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight sm:text-2xl">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0 sm:ml-4 [&>button]:w-full sm:[&>button]:w-auto">{action}</div>}
      </div>
    </div>
  )
}
