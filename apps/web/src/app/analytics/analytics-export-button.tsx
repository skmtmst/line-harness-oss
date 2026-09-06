'use client'

import Button from '@/components/shared/button'

export default function AnalyticsExportButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled: boolean
}) {
  return (
    <Button onClick={onClick} disabled={disabled} variant="secondary">
      {['CSV', 'で書き出す'].join('')}
    </Button>
  )
}
