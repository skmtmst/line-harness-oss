'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Folder } from '@line-crm/shared'
import RichMenuCreateForm, {
  freshRichMenuCreateValue,
  type RichMenuCreateValue,
  type RichMenuOption,
} from '@/components/rich-menus/rich-menu-create-form'
import { areaDraftsForCreate, createAreaDrafts } from '@/components/rich-menus/action-drafts'
import StickyBar from '@/components/shared/sticky-bar'
import Button from '@/components/shared/button'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { TEMPLATES } from '@/lib/rich-menu-templates'

export default function NewRichMenuPage() {
  usePageTitle('リッチメニューを作る')
  const router = useRouter()
  const { selectedAccount } = useAccount()
  const [value, setValue] = useState<RichMenuCreateValue>(freshRichMenuCreateValue)
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<RichMenuOption[]>([])
  const [templates, setTemplates] = useState<RichMenuOption[]>([])
  const [forms, setForms] = useState<RichMenuOption[]>([])
  const [trackedLinks, setTrackedLinks] = useState<RichMenuOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [folderRes, tagRes, templateRes, formRes, linkRes] = await Promise.allSettled([
        api.folders.list('rich_menu'),
        api.tags.list(),
        api.templates.list(),
        selectedAccount ? api.forms.list(selectedAccount.id) : Promise.resolve({ success: true as const, data: [] }),
        api.trackedLinks.list(),
      ])
      if (cancelled) return
      if (folderRes.status === 'fulfilled' && folderRes.value.success) setFolders(folderRes.value.data)
      if (tagRes.status === 'fulfilled' && tagRes.value.success) setTags(tagRes.value.data.map(({ id, name }) => ({ id, name })))
      if (templateRes.status === 'fulfilled' && templateRes.value.success) setTemplates(templateRes.value.data.map(({ id, name }) => ({ id, name })))
      if (formRes.status === 'fulfilled' && formRes.value.success) setForms(formRes.value.data.map(({ id, name }) => ({ id, name })))
      if (linkRes.status === 'fulfilled' && linkRes.value.success) setTrackedLinks(linkRes.value.data.map(({ id, name }) => ({ id, name })))
    })()
    return () => { cancelled = true }
  }, [selectedAccount])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!selectedAccount) return setError('アカウントを選択してください')
    if (!value.name.trim()) return setError('名前を入力してください')
    const selectedTemplate = TEMPLATES.find((item) => item.key === value.templateKey)
    if (!selectedTemplate) return setError('面の分けかたを選び直してください')
    const areas = value.areaDraftsByTemplate[selectedTemplate.key] ?? createAreaDrafts(selectedTemplate)
    setSubmitting(true)
    setError(null)
    try {
      const response = await api.richMenuGroups.create({
        accountId: selectedAccount.id,
        name: value.name.trim(),
        chatBarText: value.chatBarText.trim(),
        size: selectedTemplate.size,
        folderId: value.folderId || null,
        pages: Array.from({ length: value.tabCount + 1 }, (_, index) => ({
          name: index === 0 ? 'トップ' : `タブ ${String.fromCharCode(65 + index - 1)}`,
          orderIndex: index,
          areas: areaDraftsForCreate(areas),
        })),
      })
      if (!response.success) throw new Error(response.error ?? '作成失敗')
      router.push(`/rich-menus/edit?id=${response.data.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSubmitting(false)
    }
  }

  return (
    <main data-design-node="XtfO3" className="mx-auto max-w-screen-2xl py-6">
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs"><Link href="/rich-menus" className="hover:underline">リッチメニュー</Link><span className="mx-1.5">/</span><span>新規作成</span></nav>
      <form onSubmit={handleSubmit}>
        <RichMenuCreateForm
          value={value}
          onChange={setValue}
          folders={folders}
          tags={tags}
          templates={templates}
          forms={forms}
          trackedLinks={trackedLinks}
          footer={<StickyBar actions={<><Button href="/rich-menus">キャンセル</Button><Button type="submit" variant="primary" disabled={submitting || !selectedAccount}>{submitting ? '作成中...' : '下書きに保存して次へ'}</Button></>} />}
        />
        {error ? <div role="alert" className="bg-danger-bg text-danger mt-3 rounded-control border border-red-200 p-3 text-sm">{error}</div> : null}
      </form>
    </main>
  )
}
