'use client'

import { useState, type ReactNode } from 'react'
import { Eye } from 'lucide-react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'

/** 右欄を畳む画面でも同じ見本を確認できる、作成の型の入口。 */
export default function PreviewLauncher({ children, title = 'LINEの見え方', label = 'LINEの見え方を確認' }: { children: ReactNode; title?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button type="button" onClick={() => setOpen(true)}><Eye size={16} aria-hidden />{label}</Button>
    <Dialog open={open} title={title} onCancel={() => setOpen(false)}>{children}</Dialog>
  </>
}
