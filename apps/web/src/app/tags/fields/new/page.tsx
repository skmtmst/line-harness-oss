'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FriendFieldType, Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import FeatureGate from '@/components/feature-gate'
import { usePageTitle } from '@/components/shell/page-chrome'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import SelectField from '@/components/shared/select-field'
import { Field, TextInput, TextArea } from '@/components/shared/form-controls'
import { FIELD_TYPE_HINTS, FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'

const TYPES = Object.keys(FIELD_TYPE_LABELS) as FriendFieldType[]
const NEEDS_OPTIONS = new Set<FriendFieldType>(['select', 'multi_select'])
const FILE_TYPES = new Set<FriendFieldType>(['image', 'pdf'])

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
        // 画像・PDFは既定値を送らない（#1014 ATTR-07）。種類切替で値は捨てているが、念のため送り側でも止める。
        defaultValue: FILE_TYPES.has(type) ? null : defaultValue.trim() || null,
        isPersonal, isStarred,
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
        <section data-design="Basic" className="rounded-card border border-hairline bg-canvas p-5 shadow-card">
          <h2 className="mb-4 text-base font-bold text-ink">基本情報</h2>
          <div className="space-y-4">
            {/* #976 U086: 必須項目は共通の「必須」札（Field required）にそろえる。 */}
            <Field label="項目名" htmlFor="ff-name" required>
              <TextInput id="ff-name" value={name} onChange={(event) => { setName(event.target.value); if (!keyTouched) setFieldKey(suggestKey(event.target.value)) }} placeholder="例：愛犬のお名前" />
            </Field>
            <Field label="差し込み名" htmlFor="ff-key" required>
              <TextInput id="ff-key" value={fieldKey} onChange={(event) => { setKeyTouched(true); setFieldKey(event.target.value) }} placeholder="pet_name" className="font-mono" />
            </Field>
            <p className="font-mono text-xs font-semibold text-accent-deep">{`{{field.${fieldKey || 'pet_name'}}}`}</p>
            <Field label="種類" htmlFor="ff-type" note={FIELD_TYPE_HINTS[type]}>
              <SelectField
                id="ff-type"
                value={type}
                onChange={(event) => {
                  const next = event.target.value as FriendFieldType
                  setType(next)
                  /*
                    ATTR-07: 種類を変えたら既定値は捨てる。
                    入力欄は画像・PDFで無効化するだけだと、見えない古い値が
                    そのまま送信されて422で弾かれていた。テキスト系に
                    戻しても古い値を復活させない。
                  */
                  setDefaultValue('')
                }}
                aria-label="友だち情報欄の種類"
                className="v6-select w-full"
                options={TYPES.map((item) => ({ value: item, label: FIELD_TYPE_LABELS[item] }))}
              />
            </Field>
            {/*
              ATTR-19: 13種すべての説明を1段落に流すと読めない。
              選択中の種類の説明は上の note に出し、残りは開閉できる一覧へ。
            */}
            <details className="rounded-control border border-hairline bg-canvas px-3 py-2 text-xs text-ink-faint">
              <summary className="cursor-pointer font-semibold text-ink-secondary">種類の選び方（{TYPES.length}種）</summary>
              <dl className="mt-2 space-y-1">
                {TYPES.map((item) => (
                  <div key={item} className="flex gap-2">
                    <dt className="w-24 shrink-0 font-semibold text-ink">{FIELD_TYPE_LABELS[item]}</dt>
                    <dd>{FIELD_TYPE_HINTS[item]}</dd>
                  </div>
                ))}
              </dl>
            </details>
            {NEEDS_OPTIONS.has(type) ? (
              <Field label="選択肢（1行に1つ）" htmlFor="ff-options">
                <TextArea id="ff-options" rows={5} value={options} onChange={(event) => setOptions(event.target.value)} />
              </Field>
            ) : null}
            <Field label="フォルダ" htmlFor="ff-folder" note="フォルダは友だち詳細のタブになります。">
              <SelectField id="ff-folder" value={folderId} onChange={(event) => setFolderId(event.target.value)} aria-label="友だち情報欄のフォルダ" className="v6-select w-full" options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} />
            </Field>
          </div>
        </section>

        <div className="space-y-4">
          <section data-design="Value" className="rounded-card border border-hairline bg-canvas p-5 shadow-card">
            <h2 className="mb-4 text-base font-bold text-ink">値の扱い</h2>
            <Field
              label="既定値"
              htmlFor="ff-default"
              note={FILE_TYPES.has(type) ? '画像・PDFはファイルとして保存し、本文へ文字として差し込みません。' : '友だち情報が空欄のとき、この値が代わりに送信されます。'}
            >
              <TextInput id="ff-default" value={FILE_TYPES.has(type) ? '' : defaultValue} onChange={(event) => setDefaultValue(event.target.value)} disabled={FILE_TYPES.has(type)} placeholder={FILE_TYPES.has(type) ? '画像・PDFには設定できません' : '未設定'} />
            </Field>
            <div className="mt-4 divide-y divide-hairline">
              <Toggle checked={isStarred} onChange={setIsStarred} label="友だち一覧に表示" hint="よく見る項目だけを列に追加" />
              <Toggle checked={isPersonal} onChange={setIsPersonal} label="個人情報として保護" hint="権限制限と閲覧履歴を有効化" />
              <Toggle checked={ecIsMaster} onChange={setEcIsMaster} label="EC側を正とする" hint="管理画面からの上書きを防ぐ" />
            </div>
            {ecIsMaster ? (
              <div className="mt-3">
                <Field label="EC側の項目名" htmlFor="ff-ec-path">
                  <TextInput id="ff-ec-path" value={ecFieldPath} onChange={(event) => setEcFieldPath(event.target.value)} placeholder="customer.phone" className="font-mono" />
                </Field>
              </div>
            ) : null}
          </section>
          <section data-design="Immutable" className="rounded-card border border-hairline bg-canvas p-5 shadow-card"><h2 className="text-base font-bold text-ink">作成後に変更できないもの</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">種類と差し込み名は、値やテンプレートを壊さないため固定します。変更したい場合は、新しい項目への移行プレビューを使います。</p><p className="mt-2 text-xs text-ink-faint">表示先：{destination} ／ {isStarred ? '友だち一覧' : '友だち詳細'} ／ テンプレート差し込み</p></section>
        </div>
      </div>

      {/* #976 U084/U085: 追従バーの操作は共通Button。左キャンセル→右確定の並びはStickyBarが持つ。 */}
      <StickyBar status={saving ? '項目を保存しています' : '未保存'} actions={<><Button href={back ?? '/tags?tab=fields'}>キャンセル</Button><Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>{saving ? '作成中…' : '項目を作成'}</Button></>} />
    </div>
  )
}

export default function NewFriendFieldPage() {
  return <FeatureGate feature="friend_fields"><Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}><NewFriendFieldForm /></Suspense></FeatureGate>
}
