'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FriendField, Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import FeatureGate from '@/components/feature-gate'
import { usePageTitle } from '@/components/shell/page-chrome'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'
import SelectField from '@/components/shared/select-field'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import { Field, TextInput, TextArea } from '@/components/shared/form-controls'
import { FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'
import { AttributeKindGuide, DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'

const NEEDS_OPTIONS = new Set(['select', 'multi_select'])
const FILE_TYPES = new Set(['image', 'pdf'])

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start justify-between gap-4 py-2 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <span><span className="block text-sm font-semibold text-ink">{label}</span><span className="block text-xs text-ink-faint">{hint}</span></span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 accent-accent" />
    </label>
  )
}

function EditFriendFieldForm() {
  usePageTitle('友だち情報欄を編集')
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId, selectedAccount } = useAccount()

  const [field, setField] = useState<FriendField | null>(null)
  const [siblings, setSiblings] = useState<FriendField[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  /** 失敗したあとの「もう一度読み込む」で取り直すための番号。 */
  const [reloadKey, setReloadKey] = useState(0)
  const [name, setName] = useState('')
  const [options, setOptions] = useState('')
  const [defaultValue, setDefaultValue] = useState('')
  const [isPersonal, setIsPersonal] = useState(false)
  const [isStarred, setIsStarred] = useState(false)
  const [ecIsMaster, setEcIsMaster] = useState(false)
  const [ecFieldPath, setEcFieldPath] = useState('')
  const [folderId, setFolderId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) { setLoading(false); return }
    setLoading(true)
    setError('')
    setField(null)
    setNotFound(false)
    void Promise.all([
      api.friendFields.list(selectedAccountId, { withUsage: true }),
      api.folders.list('friend_field').catch(() => null),
    ]).then(([list, folderResult]) => {
      if (cancelled) return
      if (folderResult?.success) setFolders(folderResult.data)
      if (!list.success) throw new Error(list.error)
      /* IDEA-04: 同名の項目がほかにあるかは、読んだ一覧そのもので確かめる。 */
      setSiblings(list.data)
      const found = list.data.find((item) => item.id === id) ?? null
      if (!found) { setNotFound(true); return }
      setField(found)
      setName(found.name)
      setOptions((found.options ?? []).join('\n'))
      setDefaultValue(found.defaultValue ?? '')
      setIsPersonal(found.isPersonal)
      setIsStarred(found.isStarred)
      setEcIsMaster(found.ecIsMaster)
      setEcFieldPath(found.ecFieldPath ?? '')
      setFolderId(found.folderId ?? '')
    }).catch((reason) => {
      if (cancelled) return
      if (reason instanceof ApiError && reason.status === 404) {
        setError('')
        setNotFound(true)
      } else {
        setError(reason instanceof ApiError ? reason.message : '項目を読み込めませんでした')
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [id, reloadKey, selectedAccountId])

  const optionList = useMemo(() => options.split('\n').map((value) => value.trim()).filter(Boolean), [options])

  const save = async () => {
    if (saving || !field || !selectedAccountId) return
    if (!name.trim()) return setError('項目名を入力してください')
    if (NEEDS_OPTIONS.has(field.type) && optionList.length === 0) return setError('選択肢を1つ以上入力してください')
    if (ecIsMaster && !ecFieldPath.trim()) return setError('EC側の項目名を入力してください')
    setSaving(true); setError('')
    try {
      const res = await api.friendFields.update(field.id, selectedAccountId, {
        name: name.trim(),
        folderId: folderId || null,
        options: NEEDS_OPTIONS.has(field.type) ? optionList : null,
        defaultValue: FILE_TYPES.has(field.type) ? null : defaultValue.trim() || null,
        isPersonal,
        isStarred,
        ecIsMaster,
        ecFieldPath: ecIsMaster ? ecFieldPath.trim() : null,
        // 読んだ版と違えばサーバーが409で止める。他の人の先勝ちを黙って潰さない。
        version: field.version,
      })
      if (!res.success) throw new Error(res.error)
      router.push(`/tags?tab=fields&highlight=${res.data.id}`)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '項目を保存できませんでした')
    } finally { setSaving(false) }
  }

  if (loading) return <ListState kind="loading" />
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="編集する友だち情報欄が指定されていません"
        description="一覧から編集する項目を選び直してください。"
        backHref="/tags?tab=fields"
        backLabel="友だち情報欄の一覧へ戻る"
      />
    )
  }
  if (!selectedAccountId) return <p className="rounded-card border border-hairline bg-canvas p-5 text-sm text-ink-secondary">上部でLINE公式アカウントを選んでください。</p>
  if (notFound || (!error && !field)) {
    return (
      <TargetMissing
        kind="not-found"
        title="この項目は見つかりません"
        description="削除されたか、別のLINEアカウントの項目です。一覧から選び直せます。"
        accountName={selectedAccount?.name}
        backHref="/tags?tab=fields"
        backLabel="友だち情報欄の一覧へ戻る"
      />
    )
  }
  if (!field) {
    return (
      <TargetMissing
        kind="error"
        title="項目を読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    )
  }

  const locked = field.isInherited === true

  // 編集画面のPencilノードは未定。新規作成の A1ZYeP を仮に名乗ると誤比較されるので付けない。
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <Breadcrumb items={[{ label: '友だち情報欄', href: '/tags?tab=fields' }, { label: field.name }]} />
        <Button href="/tags?tab=fields">友だち情報欄へ</Button>
      </div>

      {error ? <Notice tone="danger" message={error} className="mb-4" /> : null}
      {locked ? (
        <Notice tone="warn" className="mb-4">
          共通項目はこのアカウントから直接変更できません。新しい項目へ移行してから編集してください。
        </Notice>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <section data-design="Basic" className="rounded-card border border-hairline bg-canvas p-5 shadow-card">
          <h2 className="mb-4 text-base font-bold text-ink">基本情報</h2>
          <div className="space-y-4">
            <Field label="項目名" htmlFor="ff-name" required>
              <TextInput id="ff-name" value={name} onChange={(event) => setName(event.target.value)} disabled={locked} />
              {/* IDEA-04: ほかの項目と同じ名前へ変えると、一覧の重複名の整理候補になることを先に伝える。 */}
              <DuplicateNameNote duplicates={findDuplicateNames(siblings, name, field.id)} kindLabel="項目" />
            </Field>
            {/*
              種類と差し込み名は値・テンプレートを壊すため固定（ATTR-05の
              合格条件「型・キーの固定は維持」）。入力にはせず表示だけにする。
            */}
            <div>
              <p className="text-xs font-semibold text-ink-faint">差し込み名（変更できません）</p>
              <p className="mt-1 font-mono text-xs font-semibold text-ink-secondary">{`{{field.${field.fieldKey}}}`}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-ink-faint">種類（変更できません）</p>
              <p className="mt-1 text-sm font-semibold text-ink">{FIELD_TYPE_LABELS[field.type]}</p>
            </div>
            {NEEDS_OPTIONS.has(field.type) ? (
              <Field label="選択肢（1行に1つ）" htmlFor="ff-options">
                <TextArea id="ff-options" rows={5} value={options} onChange={(event) => setOptions(event.target.value)} disabled={locked} />
              </Field>
            ) : null}
            <Field label="フォルダ" htmlFor="ff-folder" note="フォルダは友だち詳細のタブになります。">
              <SelectField id="ff-folder" value={folderId} onChange={(event) => setFolderId(event.target.value)} disabled={locked} aria-label="友だち情報欄のフォルダ" className="v6-select w-full" options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} />
            </Field>
            {/* IDEA-04: 印だけならタグ・対応状態なら対応マークという分類の違いを、編集の場所でも確認できるようにする。 */}
            <AttributeKindGuide current="field" />
          </div>
        </section>

        <div className="space-y-4">
          <section data-design="Value" className="rounded-card border border-hairline bg-canvas p-5 shadow-card">
            <h2 className="mb-4 text-base font-bold text-ink">値の扱い</h2>
            <Field
              label="既定値"
              htmlFor="ff-default"
              note={FILE_TYPES.has(field.type) ? '画像・PDFはファイルとして保存し、本文へ文字として差し込みません。' : '友だち情報が空欄のとき、この値が代わりに送信されます。'}
            >
              <TextInput id="ff-default" value={FILE_TYPES.has(field.type) ? '' : defaultValue} onChange={(event) => setDefaultValue(event.target.value)} disabled={locked || FILE_TYPES.has(field.type)} placeholder={FILE_TYPES.has(field.type) ? '画像・PDFには設定できません' : '未設定'} />
            </Field>
            <div className="mt-4 divide-y divide-hairline">
              <Toggle checked={isStarred} onChange={setIsStarred} disabled={locked} label="友だち一覧に表示" hint="よく見る項目だけを列に追加" />
              <Toggle checked={isPersonal} onChange={setIsPersonal} disabled={locked} label="個人情報として保護" hint="権限制限と閲覧履歴を有効化" />
              <Toggle checked={ecIsMaster} onChange={setEcIsMaster} disabled={locked} label="EC側を正とする" hint="管理画面からの上書きを防ぐ" />
            </div>
            {ecIsMaster ? (
              <div className="mt-3">
                <Field label="EC側の項目名" htmlFor="ff-ec-path">
                  <TextInput id="ff-ec-path" value={ecFieldPath} onChange={(event) => setEcFieldPath(event.target.value)} disabled={locked} placeholder="customer.phone" className="font-mono" />
                </Field>
              </div>
            ) : null}
          </section>
          <section data-design="Usage" className="rounded-card border border-hairline bg-canvas p-5 shadow-card">
            <h2 className="text-base font-bold text-ink">いまの使用状況</h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              値が入っている友だち：{typeof field.usageCount === 'number' ? `${field.usageCount}人` : '取得できません'}
              {field.displayTargets?.length ? ` ／ 使用先：${field.displayTargets.join('・')}` : ''}
            </p>
            <p className="mt-2 text-xs leading-5 text-ink-faint">
              {field.isPersonal ? '個人情報として保護されています。見られる・変えられるのは権限のある担当者だけです。' : '個人情報の保護は未設定です。'}
              種類と差し込み名を変えたい場合は、一覧の「移行」から新しい項目へ移してください。
            </p>
          </section>
        </div>
      </div>

      <StickyBar
        status={locked ? '共通項目は編集できません' : saving ? '保存しています' : '変更内容を確認して保存してください'}
        actions={<><Button href="/tags?tab=fields">キャンセル</Button><Button type="button" variant="primary" disabled={saving || locked} onClick={() => void save()}>{saving ? '保存中…' : '変更を保存'}</Button></>}
      />
    </div>
  )
}

export default function EditFriendFieldPage() {
  return <FeatureGate feature="friend_fields"><Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}><EditFriendFieldForm /></Suspense></FeatureGate>
}
