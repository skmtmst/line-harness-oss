import type { ReactNode } from 'react'
import Card, { CardHeader } from './card'

/** 設定フォームの段。共通カードの余白・見出しをそのまま使う。 */
export default function FormSection({ title, id, description, children, action, variant = 'form' }: {
  title: string; id: string; description?: ReactNode; children: ReactNode; action?: ReactNode
  variant?: 'form' | 'aside'
}) {
  return <Card variant={variant} aria-labelledby={id}>
    <CardHeader size="stacked" titleId={id} title={title} meta={description} action={action} />
    {children}
  </Card>
}
