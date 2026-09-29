'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { FriendField, FriendFieldType, Folder } from '@line-crm/shared'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import FeatureGate from '@/components/feature-gate'
import { usePageTitle } from '@/components/shell/page-chrome'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Notice from '@/components/shared/notice'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import StickyBar from '@/components/shared/sticky-bar'
import Select from '@/components/shared/select'
import ListState from '@/components/shared/list-state'
import { Field, TextInput, TextArea } from '@/components/shared/form-controls'
import { FIELD_TYPE_HINTS, FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'
import { AttributeKindGuide, DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'
import DefaultValueInput from '@/components/friend-fields/default-value-input'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'

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
    <Checkbox checked={checked} onCheckedChange={onChange} description={hint} className="py-2">{label}</Checkbox>
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
  /* R139: 複数選択の既定値（選択肢名の配列）。文字列欄では指定できない。 */
  const [defaultOptions, setDefaultOptions] = useState<string[]>([])
  const [isPersonal, setIsPersonal] = useState(false)
  const [isStarred, setIsStarred] = useState(true)
  const [ecIsMaster, setEcIsMaster] = useState(false)
  const [ecFieldPath, setEcFieldPath] = useState('')
  const [folderId, setFolderId] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  /*
   * IDEA-04: 同名・同じ差し込み名の項目がすでにあるとき、保存する前に
   * 知らせる。
   * R514: 既存項目が取れていないのに空一覧として扱わない。失敗は見せて
   * その場で再試行し、重複を確認できるまで保存を止める。
   */
  const [existing, setExisting] = useState<FriendField[]>([])
  const [existingState, setExistingState] = useState<'loading' | 'ready' | 'error'>('loading')
  /** フォルダが取れない間は未分類だけに見える。隠さず、選び直せるようにする。 */
  const [foldersState, setFoldersState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reloading, setReloading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /*
   * R515: 同じ作成のやり直しは同じ要求キーで送る。入力を変えたら
   * 新しいキーにする（同じキーに異なる内容はサーバが409で止める）。
   */
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID())

  const loadFolders = useCallback(async () => {
    setReloading(true)
    try {
      const res = await api.folders.list('friend_field')
      if (!res.success) throw new Error(res.error)
      setFolders(res.data)
      setFoldersState('ready')
    } catch {
      setFoldersState('error')
    } finally {
      setReloading(false)
    }
  }, [])

  const loadExisting = useCallback(async () => {
    const account = selectedAccountId
    if (!account) {
      setExistingState('error')
      return
    }
    setReloading(true)
    try {
      const res = await api.friendFields.list(account)
      if (!res.success) throw new Error(res.error)
      setExisting(res.data)
      setExistingState('ready')
    } catch {
      // R514: 失敗を隠して空一覧にしない。入力は残し、再試行を出す。
      setExistingState('error')
    } finally {
      setReloading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void loadFolders() }, [loadFolders])
  useEffect(() => { void loadExisting() }, [loadExisting])
  // 入力の中身が変わったら、次に押す作成は別の要求として新しいキーにする。
  useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID()
  }, [name, fieldKey, type, folderId, options, defaultValue, defaultOptions, isPersonal, isStarred, ecIsMaster, ecFieldPath])

  /*
   * 入力がひとつでも入ったら未保存（作成系の他画面と同じ考え方）。
   * この下書きはどこにも自動保存されないので、離脱前に必ず確認する。
   */
  const dirty = Boolean(
    name || fieldKey || keyTouched || type !== 'text' || options || defaultValue || defaultOptions.length > 0
      || isPersonal || !isStarred || ecIsMaster || ecFieldPath || folderId,
  )
  /*
   * 未保存の入力がある間、画面を離れる操作を止める共通の番兵（DETAIL-04系）。
   * 左メニュー・「友だち情報欄へ」・戻る操作・再読込を同じ確認対話へ寄せる。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const optionList = useMemo(() => options.split('\n').map((value) => value.trim()).filter(Boolean), [options])
  const destination = folders.find((folder) => folder.id === folderId)?.name ?? '未分類'
  const nameDuplicates = useMemo(() => findDuplicateNames(existing, name), [existing, name])
  const keyOwners = useMemo(() => {
    const key = fieldKey.trim()
    if (!key) return []
    return existing.filter((item) => item.fieldKey === key).map((item) => item.name)
  }, [existing, fieldKey])

  // R514: 既存項目を読めていない間の保存は送らない（重複を確認できないため）。
  const listBlocked = existingState !== 'ready'
  const save = async () => {
    if (saving) return
    if (!selectedAccountId) return setError('LINE公式アカウントを選んでください')
    if (listBlocked) return
    if (!name.trim()) return setError('項目名を入力してください')
    if (!fieldKey.trim()) return setError('差し込み名を入力してください')
    if (NEEDS_OPTIONS.has(type) && optionList.length === 0) return setError('選択肢を1つ以上入力してください')
    if (ecIsMaster && !ecFieldPath.trim()) return setError('EC側の項目名を入力してください')
    /*
     * R139: 選択肢を変えたあとに残った既定値は送る前に止める。
     * サーバーの「存在しない選択肢」422を先に言葉にする。
     */
    if (type === 'multi_select') {
      const missing = defaultOptions.filter((item) => !optionList.includes(item))
      if (missing.length > 0) return setError(`既定値の「${missing[0]}」は選択肢にありません。選択肢か既定値を直してください`)
    }
    if (type === 'select' && defaultValue && !optionList.includes(defaultValue)) {
      return setError(`既定値の「${defaultValue}」は選択肢にありません。選択肢か既定値を直してください`)
    }
    setSaving(true); setError('')
    try {
      const res = await api.friendFields.create(selectedAccountId, {
        name: name.trim(), fieldKey: fieldKey.trim(), type, folderId: folderId || null,
        options: NEEDS_OPTIONS.has(type) ? optionList : null,
        // 画像・PDFは既定値を送らない（#1014 ATTR-07）。種類切替で値は捨てているが、念のため送り側でも止める。
        // R139: 複数選択は選択肢名の配列で渡す。文字列では422になる。
        defaultValue: FILE_TYPES.has(type)
          ? null
          : type === 'multi_select'
            ? (defaultOptions.length > 0 ? defaultOptions : null)
            : type === 'select'
              ? (defaultValue || null)
              : defaultValue.trim() || null,
        isPersonal, isStarred,
        ecIsMaster, ecFieldPath: ecIsMaster ? ecFieldPath.trim() : null,
        // R515: 同じ作成のやり直しは同じ要求キーで送り、二重に作らない。
      }, idempotencyKeyRef.current)
      if (!res.success) throw new Error(res.error)
      router.push(back ?? `/tags?tab=fields&highlight=${res.data.id}`)
    } catch (reason) {
      setError(describeSaveFailure(reason))
    } finally { setSaving(false) }
  }

  return (
    <div data-design-node="A1ZYeP" className="flex flex-col gap-4">
      {/* R177: 同じ見出し行の形。パンくずを縮め、戻り先は残す。 */}
      {/* m22c: 見出し行の戻りは共通の行き先リンク（カード見出しと同じ13px/600青文字）。ボタン枠のままでは分類案内の行き先リンクとずれる（自動点検 k=10）。 */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Breadcrumb items={[{ label: '友だち情報欄', href: '/tags?tab=fields' }, { label: '項目を作る' }]} />
        </div>
        <Link href={back ?? '/tags?tab=fields'} className="text-status-info shrink-0 text-label font-semibold hover:underline">友だち情報欄へ</Link>
      </div>

      {/* R514: 既存項目の取得失敗は隠さず、その場で再試行する。入力は残す。 */}
      {existingState === 'error' ? (
        <div className="mb-4">
          <ListState
            kind="error"
            title="既存の項目を読み込めませんでした"
            description="重複を確認できないため、読み直すまで保存できません。入力内容はそのままです。"
            onRetry={() => void loadExisting()}
            retrying={reloading}
          />
        </div>
      ) : null}
      {error ? <Notice tone="danger" message={error} className="mb-4" /> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <section data-design="Basic" className="rounded-card border border-hairline bg-canvas p-5 shadow-card">
          <h2 className="mb-4 text-base font-bold text-ink">基本情報</h2>
          <div className="space-y-4">
            {/* #976 U086: 必須項目は共通の「必須」札（Field required）にそろえる。 */}
            <Field label="項目名" htmlFor="ff-name" required>
              <TextInput id="ff-name" value={name} onChange={(event) => { setName(event.target.value); if (!keyTouched) setFieldKey(suggestKey(event.target.value)) }} placeholder="例：愛犬のお名前" />
              <DuplicateNameNote duplicates={nameDuplicates} kindLabel="項目" />
            </Field>
            <Field label="差し込み名" htmlFor="ff-key" required>
              <TextInput id="ff-key" value={fieldKey} onChange={(event) => { setKeyTouched(true); setFieldKey(event.target.value) }} placeholder="pet_name" className="font-mono" />
              {/* 差し込み名はサーバーが一意にする。先に教えておかないと保存して初めて断られる。 */}
              {keyOwners.length > 0 ? <p className="mt-1.5 text-xs leading-5 text-status-warn-deep">この差し込み名はすでに「{keyOwners[0]}」で使われています。別の差し込み名にしてください。</p> : null}
            </Field>
            <p className="font-mono text-xs font-semibold text-ink-secondary">{`{{field.${fieldKey || 'pet_name'}}}`}</p>
            <Field label="種類" htmlFor="ff-type" note={FIELD_TYPE_HINTS[type]}>
              <Select
                id="ff-type"
                value={type}
                onChange={(value) => {
                  const next = value as FriendFieldType
                  setType(next)
                  /*
                    ATTR-07: 種類を変えたら既定値は捨てる。
                    入力欄は画像・PDFで無効化するだけだと、見えない古い値が
                    そのまま送信されて422で弾かれていた。テキスト系に
                    戻しても古い値を復活させない。R139: 選択式の既定値も捨てる。
                  */
                  setDefaultValue('')
                  setDefaultOptions([])
                }}
                aria-label="友だち情報欄の種類"
                size="full"
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
              <Select id="ff-folder" value={folderId} onChange={(value) => setFolderId(value)} aria-label="友だち情報欄のフォルダ" size="full" options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} />
              {foldersState === 'error' ? (
                <p className="mt-1.5 text-xs leading-5 text-ink-secondary">
                  フォルダを読み込めませんでした。今は未分類にしか入れられません。
                  <button type="button" onClick={() => void loadFolders()} disabled={reloading} className="ml-1 font-semibold text-status-info hover:underline disabled:opacity-40">
                    {reloading ? '読み込んでいます' : 'もう一度読み込む'}
                  </button>
                </p>
              ) : null}
            </Field>
            {/* IDEA-04: 「情報欄」を選んだ理由と、印だけならタグ・対応状態なら対応マークという違いを、作る場所で確認できるようにする。 */}
            <AttributeKindGuide current="field" />
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
              {/* R139: 複数選択は登録済みの選択肢から複数選ぶ。単一選択は一覧から1つ選ぶ。 */}
              <DefaultValueInput
                mode={FILE_TYPES.has(type) ? 'file' : type === 'multi_select' ? 'multi' : type === 'select' ? 'single' : type === 'textarea' ? 'longtext' : 'text'}
                options={optionList}
                textValue={defaultValue}
                onTextChange={setDefaultValue}
                singleValue={defaultValue}
                onSingleChange={setDefaultValue}
                multiValue={defaultOptions}
                onMultiChange={setDefaultOptions}
                inputId="ff-default"
              />
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
      {/* R514: 重複を確認できるまで保存は押させず、理由を状態文に出す。 */}
      <StickyBar status={saving ? '項目を保存しています' : listBlocked ? '既存の項目を読み直すと保存できます' : '未保存'} actions={<><Button href={back ?? '/tags?tab=fields'}>キャンセル</Button><Button type="button" variant="primary" disabled={saving || listBlocked} onClick={() => void save()}>{saving ? '作成中…' : '項目を作成'}</Button></>} />
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

export default function NewFriendFieldPage() {
  return <FeatureGate feature="friend_fields"><Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}><NewFriendFieldForm /></Suspense></FeatureGate>
}
