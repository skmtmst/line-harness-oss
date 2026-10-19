'use client'

import Button from '@/components/shared/button';


function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-hairline flex gap-4 border-b py-2.5 last:border-b-0">
      <span className="text-ink-faint w-28 shrink-0 pt-0.5 text-xs font-medium">{label}</span>
      <div className="text-ink flex-1 text-sm break-words">{children}</div>
    </div>
  )
}


function ActionButtons({
  status,
  onAction,
}: {
  status: string
  onAction: (a: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete') => void
}) {
  if (status === 'requested') {
    return (
      <div className="inline-flex gap-1">
        <Button variant="primary" className="px-3 py-1 text-xs font-medium border-0 h-auto whitespace-normal" onClick={() => onAction('approve')}>
          承認
        </Button>
        <button
          onClick={() => onAction('reject')}
          className="text-danger bg-danger-bg rounded-mini px-3 py-1 text-xs font-medium hover:bg-status-danger-selected"
        >
          拒否
        </button>
      </div>
    )
  }
  if (status === 'confirmed') {
    return (
      <div className="inline-flex gap-1">
        <button
          onClick={() => onAction('complete')}
          className="bg-info-bg text-info rounded-mini px-3 py-1 text-xs font-medium hover:bg-hairline"
        >
          閉じる
        </button>
        <button
          onClick={() => onAction('no_show')}
          className="bg-warning-bg text-warning rounded-mini px-3 py-1 text-xs font-medium hover:bg-hairline"
        >
          無断
        </button>
        <button
          onClick={() => onAction('cancel')}
          className="text-ink-secondary bg-canvas-sunken rounded-mini px-3 py-1 text-xs font-medium hover:bg-hairline"
        >
          取消
        </button>
      </div>
    )
  }
  return <span className="text-ink-faint text-xs">-</span>
}
export { DetailRow, ActionButtons }
