'use client'

import { useState, type ReactNode } from 'react'
import { Eye } from 'lucide-react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'

/** 右欄を畳む画面でも同じ見本を確認できる、作成の型の入口。 */
export default function PreviewLauncher({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button type="button" onClick={() => setOpen(true)}><Eye size={16} aria-hidden />LINEの見え方を確認</Button>
    <Dialog open={open} title="LINEの見え方" onCancel={() => setOpen(false)}>{children}</Dialog>
  </>
}
