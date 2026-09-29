'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { FriendField, Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { isSameFieldContent, type SentFieldContent } from './field-edit-conflict'
import { useAccount } from '@/contexts/account-context'
import FeatureGate from '@/components/feature-gate'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'
import Select from '@/components/shared/select'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import { Field, TextInput, TextArea } from '@/components/shared/form-controls'
import { FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'
import { AttributeKindGuide, DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'
import DefaultValueInput from '@/components/friend-fields/default-value-input'

const NEEDS_OPTIONS = new Set(['select', 'multi_select'])
const FILE_TYPES = new Set(['image', 'pdf'])

function isLockedField(field: FriendField): boolean {
  return field.isInherited === true
}

/*
 * R182: 保存済みの既定値はID（複数選択はIDの配列のJSON）で入っている。
 * 画面は選択肢名で持つため、読み込み時と同じ戻し方で「保存済みの
 * 選択肢名」を作り、未保存の判定に使う。IDのまま比べると、単一選択は
 * 開いた瞬間に未保存扱いになり、複数選択は変えても未保存にならない。
 */
function storedDefaultLabels(field: FriendField): { single: string; multi: string[] } {
  const stored = field.defaultValue ?? ''
  const labels = field.options ?? []
  const definitions = field.optionDefinitions ?? null
  const toLabel = (entry: string): string | null =>
    definitions?.find((item) => item.id === entry)?.label
    ?? (labels.includes(entry) ? entry : null)
  if (field.type === 'multi_select') {
    let entries: string[] = []
    try {
      const parsed: unknown = JSON.parse(stored)
      if (Array.isArray(parsed)) entries = parsed.map(String)
    } catch { entries = [] }
    return { single: '', multi: entries.map(toLabel).filter((item): item is string => item !== null) }
  }
  if (field.type === 'select' && stored) return { single: toLabel(stored) ?? '', multi: [] }
  return { single: stored, multi: [] }
}

function sameLabels(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((item, index) => item === sortedB[index])
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <Checkbox checked={checked} onCheckedChange={onChange} disabled={disabled} description={hint} className="py-2">{label}</Checkbox>
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
  /*
   * R516: フォルダが取れない間は「未分類」だけの選択欄を見せない。
   * 所属IDは入力に残るため、表示と保存内容が食い違う誤認を防ぐ。
   */
  const [foldersState, setFoldersState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [foldersReloading, setFoldersReloading] = useState(false)
  /*
   * R517: 版の衝突で返ってきた最新の内容。入力は残したまま、
   * 保存済みか他人の変更かを見せて選ばせる。
   */
  const [conflictName, setConflictName] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  /** 失敗したあとの「もう一度読み込む」で取り直すための番号。 */
  const [reloadKey, setReloadKey] = useState(0)
  const [name, setName] = useState('')
  const [options, setOptions] = useState('')
  const [defaultValue, setDefaultValue] = useState('')
  /* R139: 複数選択の既定値（選択肢名の配列）。 */
  const [defaultOptions, setDefaultOptions] = useState<string[]>([])
  const [isPersonal, setIsPersonal] = useState(false)
  const [isStarred, setIsStarred] = useState(false)
  const [ecIsMaster, setEcIsMaster] = useState(false)
  const [ecFieldPath, setEcFieldPath] = useState('')
  const [folderId, setFolderId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadFolders = useCallback(async () => {
    if (!selectedAccountId) return
    setFoldersReloading(true)
    try {
      const res = await api.folders.list('friend_field')
      if (!res.success) throw new Error(res.error)
      setFolders(res.data)
      setFoldersState('ready')
    } catch {
      // R516: 失敗を隠さず、所属の選択欄の場所で再試行する。
      setFoldersState('error')
    } finally {
      setFoldersReloading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) { setLoading(false); return }
    setLoading(true)
    setError('')
    setField(null)
    setNotFound(false)
    setConflictName(null)
    setJustSaved(false)
    void Promise.all([
      api.friendFields.list(selectedAccountId, { withUsage: true }),
      api.folders.list('friend_field').catch(() => null),
    ]).then(([list, folderResult]) => {
      if (cancelled) return
      if (folderResult?.success) {
        setFolders(folderResult.data)
        setFoldersState('ready')
      } else {
        setFoldersState('error')
      }
      if (!list.success) throw new Error(list.error)
      /* IDEA-04: 同名の項目がほかにあるかは、読んだ一覧そのもので確かめる。 */
      setSiblings(list.data)
      const found = list.data.find((item) => item.id === id) ?? null
      if (!found) { setNotFound(true); return }
      setField(found)
      setName(found.name)
      setOptions((found.options ?? []).join('\n'))
      /* R139: 保存済みの既定値は選択肢名へ戻して持つ（IDのまま見せない）。 */
      {
        const stored = storedDefaultLabels(found)
        setDefaultOptions(stored.multi)
        setDefaultValue(stored.single)
      }
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

  /*
   * R176 監査：名称・既定値を変えたまま一覧へ移ると、確認なく入力が
   * 消える（新規には番兵がある）。読み込んだ項目との差を未保存とし、
   * 離れる操作では確認を出す。保存の成功後は別画面へ送るため、
   * 確認が出ることはない。
   */
  /* R182: 既定値は保存済みの選択肢名と比べる（IDのまま比べない）。 */
  const storedDefaults = field ? storedDefaultLabels(field) : null
  const dirty = field !== null && storedDefaults !== null && !isLockedField(field) && (
    name !== field.name
    || options !== (field.options ?? []).join('\n')
    || defaultValue !== storedDefaults.single
    || !sameLabels(defaultOptions, storedDefaults.multi)
    || isPersonal !== field.isPersonal
    || isStarred !== field.isStarred
    || ecIsMaster !== field.ecIsMaster
    || ecFieldPath !== (field.ecFieldPath ?? '')
    || folderId !== (field.folderId ?? '')
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  /*
   * R517: 送る内容を1か所で組み立てる。409のときに送った内容と
   * 最新を比べるため、送ったものをそのまま比べに使える形で返す。
   */
  const buildSentPayload = (): SentFieldContent | null => {
    if (!field) return null
    if (!name.trim()) { setError('項目名を入力してください'); return null }
    if (NEEDS_OPTIONS.has(field.type) && optionList.length === 0) { setError('選択肢を1つ以上入力してください'); return null }
    if (ecIsMaster && !ecFieldPath.trim()) { setError('EC側の項目名を入力してください'); return null }
    /* R139: 選択肢から外れた既定値は送る前に止める（新規作成と同じ文）。 */
    if (field.type === 'multi_select') {
      const missing = defaultOptions.filter((item) => !optionList.includes(item))
      if (missing.length > 0) { setError(`既定値の「${missing[0]}」は選択肢にありません。選択肢か既定値を直してください`); return null }
    }
    if (field.type === 'select' && defaultValue && !optionList.includes(defaultValue)) {
      setError(`既定値の「${defaultValue}」は選択肢にありません。選択肢か既定値を直してください`); return null
    }
    return {
      name: name.trim(),
      folderId: folderId || null,
      options: NEEDS_OPTIONS.has(field.type) ? optionList : null,
      /* R139: 複数選択は選択肢名の配列で渡す。文字列では422になる。 */
      defaultValue: FILE_TYPES.has(field.type)
        ? null
        : field.type === 'multi_select'
          ? (defaultOptions.length > 0 ? defaultOptions : null)
          : field.type === 'select'
            ? (defaultValue || null)
            : defaultValue.trim() || null,
      isPersonal,
      isStarred,
      ecIsMaster,
      ecFieldPath: ecIsMaster ? ecFieldPath.trim() : null,
    }
  }

  /*
   * R517: 版の衝突で返ってきたとき、最新を取り直して送った内容と比べる。
   * 同じなら応答消失前の保存が成功しているので保存済みと案内し、
   * 違うなら他人の変更として差分と取り込み口を示す。入力は残す。
   */
  const handleVersionConflict = async (sent: SentFieldContent) => {
    const account = selectedAccountId
    if (!account || !field) return
    try {
      const res = await api.friendFields.list(account, { withUsage: true })
      if (!res.success) throw new Error(res.error)
      const latest = res.data.find((item) => item.id === field.id) ?? null
      if (!latest) {
        setError('項目が見つかりません。一覧から選び直してください。')
        setNotFound(true)
        return
      }
      setSiblings(res.data)
      if (isSameFieldContent(sent, latest)) {
        setField(latest)
        setConflictName(null)
        setJustSaved(true)
        setError('')
      } else {
        // 版だけ進め、入力は残す。保存し直すと新しい版で送られる。
        setField(latest)
        setConflictName(latest.name)
        setJustSaved(false)
        setError('ほかの担当者が先に変更しました。最新の内容を確認してから保存し直してください。')
      }
    } catch {
      setError('最新の内容を確認できませんでした。接続を確かめて、もう一度保存してください。')
    }
  }

  const save = async () => {
    if (saving || !field || !selectedAccountId) return
    const sent = buildSentPayload()
    if (!sent) return
    setSaving(true); setError('')
    setConflictName(null)
    setJustSaved(false)
    try {
      const res = await api.friendFields.update(field.id, selectedAccountId, {
        ...sent,
        // 読んだ版と違えばサーバーが409で止める。他の人の先勝ちを黙って潰さない。
        version: field.version,
      })
      if (!res.success) throw new Error(res.error)
      router.push(`/tags?tab=fields&highlight=${res.data.id}`)
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409
        && (reason as { code?: string }).code === 'VERSION_CONFLICT') {
        await handleVersionConflict(sent)
      } else {
        setError(reason instanceof ApiError ? reason.message : '項目を保存できませんでした')
      }
    } finally { setSaving(false) }
  }

  /*
   * R517: 最新の内容を入力へ取り込む。取り込んだ分は未保存になるので、
   * そのまま保存し直すと最新の版で送られる。
   */
  const applyLatest = () => {
    if (!field) return
    setName(field.name)
    setOptions((field.options ?? []).join('\n'))
    const stored = storedDefaultLabels(field)
    setDefaultOptions(stored.multi)
    setDefaultValue(stored.single)
    setIsPersonal(field.isPersonal)
    setIsStarred(field.isStarred)
    setEcIsMaster(field.ecIsMaster)
    setEcFieldPath(field.ecFieldPath ?? '')
    setFolderId(field.folderId ?? '')
    setConflictName(null)
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
    <div className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      {/* R177: 長い項目名で戻りが右へ押し出されていた。パンくずを縮め、戻り先は残す。 */}
      {/* m22c: 見出し行の戻りは共通の行き先リンク（カード見出しと同じ13px/600青文字）。 */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Breadcrumb items={[{ label: '友だち情報欄', href: '/tags?tab=fields' }, { label: field.name }]} />
        </div>
        <Link href="/tags?tab=fields" className="text-status-info shrink-0 text-label font-semibold hover:underline">友だち情報欄へ</Link>
      </div>

      {error ? <Notice tone="danger" message={error} className="mb-4" /> : null}
      {/* R517: 応答消失後の再試行で、送った内容が保存済みと分かった。 */}
      {justSaved && field ? (
        <Notice
          tone="success"
          className="mb-4"
          action={<Button type="button" onClick={() => router.push(`/tags?tab=fields&highlight=${field.id}`)}>一覧で確認する</Button>}
        >
          保存されています。入力した内容は最新の保存内容と同じです。
        </Notice>
      ) : null}
      {/* R517: ほかの担当者の変更と入力を比べて決める。入力は残す。 */}
      {conflictName !== null && field ? (
        <Notice
          tone="warn"
          className="mb-4"
          action={<Button type="button" onClick={applyLatest}>最新の内容を取り込む</Button>}
        >
          最新の保存内容は「{conflictName}」です。入力内容はそのまま残しています。
          入力のまま保存し直すか、最新の内容を取り込んでください。
        </Notice>
      ) : null}
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
              {/*
                R516: フォルダが取れない間は「未分類」だけの選択欄を出さない。
                入力に残っている所属IDと表示が食い違う誤認を防ぐ。
              */}
              {foldersState === 'error' ? (
                <p className="text-xs leading-5 text-ink-secondary">
                  所属を読み込めませんでした。今の所属は変わらず保存されます。
                  <button type="button" onClick={() => void loadFolders()} disabled={foldersReloading} className="ml-1 font-semibold text-status-info hover:underline disabled:opacity-40">
                    {foldersReloading ? '読み込んでいます' : 'もう一度読み込む'}
                  </button>
                </p>
              ) : (
                <Select id="ff-folder" value={folderId} onChange={(value) => setFolderId(value)} disabled={locked} aria-label="友だち情報欄のフォルダ" size="full" options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} />
              )}
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
              {/* R139: 複数選択は登録済みの選択肢から複数選ぶ。単一選択は一覧から1つ選ぶ。 */}
              <DefaultValueInput
                mode={FILE_TYPES.has(field.type) ? 'file' : field.type === 'multi_select' ? 'multi' : field.type === 'select' ? 'single' : field.type === 'textarea' ? 'longtext' : 'text'}
                options={optionList}
                textValue={defaultValue}
                onTextChange={setDefaultValue}
                singleValue={defaultValue}
                onSingleChange={setDefaultValue}
                multiValue={defaultOptions}
                onMultiChange={setDefaultOptions}
                disabled={locked}
                inputId="ff-default"
              />
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
      {/* R176 監査：名称・既定値などの書きかけがある間の離脱確認。 */}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="項目への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

export default function EditFriendFieldPage() {
  return <FeatureGate feature="friend_fields"><Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}><EditFriendFieldForm /></Suspense></FeatureGate>
}
