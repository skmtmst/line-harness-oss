'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { FriendFieldType, Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import SelectField from '@/components/shared/select-field'
import { FIELD_TYPE_HINTS, FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'

const TYPES = Object.keys(FIELD_TYPE_LABELS) as FriendFieldType[]
const NEEDS_OPTIONS = new Set<FriendFieldType>(['select', 'multi_select'])

function suggestKey(name: string): string {
  const ascii = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!ascii || !/^[a-z]/.test(ascii)) return ''
  return ascii.slice(0, 32)
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (next: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span><span className="block text-sm font-semibold text-ink">{label}</span><span className="block text-xs text-ink-faint">{hint}</span></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 accent-accent" />
    </label>
  )
}

function NewFriendFieldForm() {
  usePageTitle('友だち情報欄を追加')
  const router = useRouter()
  const params = useSearchParams()
  const back = params.get('back')
  const { selectedAccountId } = useAccount()

  const [name, setName] = useState('')
  const [fieldKey, setFieldKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState<FriendFieldType>('text')
  const [options, setOptions] = useState('')
  const [defaultValue, setDefaultValue] = useState('')
  const [isPersonal, setIsPersonal] = useState(false)
  const [isStarred, setIsStarred] = useState(true)
  const [ecIsMaster, setEcIsMaster] = useState(false)
  const [ecFieldPath, setEcFieldPath] = useState('')
  const [folderId, setFolderId] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { void api.folders.list('friend_field').then((res) => { if (res.success) setFolders(res.data) }) }, [])

  const optionList = useMemo(() => options.split('\n').map((value) => value.trim()).filter(Boolean), [options])
  const destination = folders.find((folder) => folder.id === folderId)?.name ?? '未分類'

  const save = async () => {
    if (saving) return
    if (!selectedAccountId) return setError('LINE公式アカウントを選んでください')
    if (!name.trim()) return setError('項目名を入力してください')
    if (!fieldKey.trim()) return setError('差し込み名を入力してください')
    if (NEEDS_OPTIONS.has(type) && optionList.length === 0) return setError('選択肢を1つ以上入力してください')
    if (ecIsMaster && !ecFieldPath.trim()) return setError('EC側の項目名を入力してください')
    setSaving(true); setError('')
    try {
      const res = await api.friendFields.create(selectedAccountId, {
        name: name.trim(), fieldKey: fieldKey.trim(), type, folderId: folderId || null,
        options: NEEDS_OPTIONS.has(type) ? optionList : null,
        defaultValue: defaultValue.trim() || null, isPersonal, isStarred,
        ecIsMaster, ecFieldPath: ecIsMaster ? ecFieldPath.trim() : null,
      })
      if (!res.success) throw new Error(res.error)
      router.push(back ?? `/tags?tab=fields&highlight=${res.data.id}`)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '項目を作成できませんでした')
    } finally { setSaving(false) }
  }

  return (
    <div data-design-node="A1ZYeP">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Breadcrumb items={[{ label: '友だち情報欄', href: '/tags?tab=fields' }, { label: '項目を追加' }]} />
        <Button href={back ?? '/tags?tab=fields'}>友だち情報欄へ</Button>
      </div>

      {error ? <p role="alert" className="mb-4 rounded-control border border-danger/20 bg-danger-bg p-3 text-sm text-danger">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <section data-design="Basic" className="rounded-card border border-hairline bg-canvas p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
          <h2 className="mb-4 text-base font-bold text-ink">基本情報</h2>
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-ink">項目名（必須）<input value={name} onChange={(event) => { setName(event.target.value); if (!keyTouched) setFieldKey(suggestKey(event.target.value)) }} placeholder="例：愛犬のお名前" className="mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-normal outline-none focus:border-accent" /></label>
            <label className="block text-sm font-semibold text-ink">差し込み名（必須）<input value={fieldKey} onChange={(event) => { setKeyTouched(true); setFieldKey(event.target.value) }} placeholder="pet_name" className="mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-mono font-normal outline-none focus:border-accent" /></label>
            <p className="font-mono text-xs font-semibold text-accent">{`{{field.${fieldKey || 'pet_name'}}}`}</p>
            <label className="block text-sm font-semibold text-ink">種類<SelectField value={type} onChange={(event) => setType(event.target.value as FriendFieldType)} aria-label="友だち情報欄の種類" className="v6-select mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-normal" options={[{ value: type, label: `${FIELD_TYPE_LABELS[type]} — ${FIELD_TYPE_HINTS[type]}` }, ...TYPES.filter((item) => item !== type).map((item) => ({ value: item, label: `${FIELD_TYPE_LABELS[item]} — ${FIELD_TYPE_HINTS[item]}` }))]} /></label>
            <p className="text-xs text-ink-faint">{TYPES.map((item) => FIELD_TYPE_LABELS[item]).join(' ／ ')}</p>
            {NEEDS_OPTIONS.has(type) ? <label className="block text-sm font-semibold text-ink">選択肢（1行に1つ）<textarea rows={5} value={options} onChange={(event) => setOptions(event.target.value)} className="mt-1.5 w-full rounded-control border border-hairline bg-canvas p-3 font-normal" /></label> : null}
            <label className="block text-sm font-semibold text-ink">フォルダ<SelectField value={folderId} onChange={(event) => setFolderId(event.target.value)} aria-label="友だち情報欄のフォルダ" className="v6-select mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-normal" options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} /><span className="mt-1 block text-xs font-normal text-ink-faint">フォルダは友だち詳細のタブになります。</span></label>
          </div>
        </section>

        <div className="space-y-4">
          <section data-design="Value" className="rounded-card border border-hairline bg-canvas p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
            <h2 className="mb-4 text-base font-bold text-ink">値の扱い</h2>
            <label className="block text-sm font-semibold text-ink">既定値<input value={defaultValue} onChange={(event) => setDefaultValue(event.target.value)} placeholder="未設定" className="mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-normal" /><span className="mt-1 block text-xs font-normal text-ink-faint">友だち情報が空欄のとき、この値が代わりに送信されます。</span></label>
            <div className="mt-4 divide-y divide-hairline">
              <Toggle checked={isStarred} onChange={setIsStarred} label="友だち一覧に表示" hint="よく見る項目だけを列に追加" />
              <Toggle checked={isPersonal} onChange={setIsPersonal} label="個人情報として保護" hint="権限制限と閲覧履歴を有効化" />
              <Toggle checked={ecIsMaster} onChange={setEcIsMaster} label="EC側を正とする" hint="管理画面からの上書きを防ぐ" />
            </div>
            {ecIsMaster ? <label className="mt-3 block text-sm font-semibold text-ink">EC側の項目名<input value={ecFieldPath} onChange={(event) => setEcFieldPath(event.target.value)} placeholder="customer.phone" className="mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-mono font-normal" /></label> : null}
          </section>
          <section data-design="Immutable" className="rounded-card border border-hairline bg-canvas p-5 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]"><h2 className="text-base font-bold text-ink">作成後に変更できないもの</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">種類と差し込み名は、値やテンプレートを壊さないため固定します。変更したい場合は、新しい項目への移行プレビューを使います。</p><p className="mt-2 text-xs text-ink-faint">表示先：{destination} ／ {isStarred ? '友だち一覧' : '友だち詳細'} ／ テンプレート差し込み</p></section>
        </div>
      </div>

      <StickyBar status={saving ? '項目を保存しています' : '未保存'} actions={<><Link href={back ?? '/tags?tab=fields'} className="rounded-control border border-hairline bg-canvas px-4 py-2 text-sm font-semibold text-ink">キャンセル</Link><button type="button" disabled={saving} onClick={() => void save()} className="rounded-control bg-accent-deep px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-40">{saving ? '作成中…' : '項目を作成'}</button></>} />
    </div>
  )
}

export default function NewFriendFieldPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}><NewFriendFieldForm /></Suspense>
}
