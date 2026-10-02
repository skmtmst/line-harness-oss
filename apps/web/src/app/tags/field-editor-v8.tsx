'use client'

/*
 * ★V8 友だち情報欄を作る・編集（Pencil `EhEXu`）。
 *
 * v7（app/tags/fields/new・edit の page.tsx）と動きは同じで、
 * 置き場だけを V8 の絵へ合わせる。左に「基本」「種類」「値の扱い」の段、
 * 右の欄に「出す場所」「使っている所」（編集）・「作成後に変更できないもの」。
 * 追従バーはキャンセル・保存＝真ん中（オーナー決定 2026-10-01）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FriendField, FriendFieldType, Folder } from '@line-crm/shared'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import { RequiredBadge } from '@/components/shared/form-controls'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { FIELD_TYPE_HINTS, FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'
import { AttributeKindGuide, DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'
import DefaultValueInput from '@/components/friend-fields/default-value-input'
import { sameLabels, storedDefaultLabels } from './fields/edit/page'
import styles from './field-editor-v8.module.css'

const TYPES = Object.keys(FIELD_TYPE_LABELS) as FriendFieldType[]
const NEEDS_OPTIONS = new Set<FriendFieldType>(['select', 'multi_select'])
const FILE_TYPES = new Set<FriendFieldType>(['image', 'pdf'])

function suggestKey(name: string): string {
  const ascii = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!ascii || !/^[a-z]/.test(ascii)) return ''
  return ascii.slice(0, 32)
}

export interface FieldEditorValues {
  name: string
  fieldKey: string
  type: FriendFieldType
  folderId: string
  options: string[] | null
  defaultValue: string | string[] | null
  isPersonal: boolean
  isStarred: boolean
  ecIsMaster: boolean
  ecFieldPath: string
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <div className={styles.toggleRow}>
      <div className="min-w-0">
        <span className={styles.toggleLabel}>{label}</span>
        <p className={styles.toggleHint}>{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
      >
        <span className={styles.toggleKnob} />
      </button>
    </div>
  )
}

export default function FieldEditorV8({
  mode,
  field = null,
  locked = false,
  folders,
  foldersState,
  foldersReloading = false,
  onRetryFolders,
  siblings,
  siblingsReady,
  saving,
  error,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  field?: FriendField | null
  locked?: boolean
  folders: Folder[]
  foldersState: 'loading' | 'ready' | 'error'
  foldersReloading?: boolean
  onRetryFolders?: () => void
  /** IDEA-04: 同名・同じ差し込み名の確認に使う既存の項目。 */
  siblings: FriendField[]
  /** R514: 既存項目を読めていない間の保存は送らない。 */
  siblingsReady: boolean
  saving: boolean
  error?: string
  onCancel: () => void
  /** 作成は第2引数に冪等キーが入る（R515）。編集では使わない。 */
  onSubmit: (values: FieldEditorValues, requestKey: string) => void
}) {
  usePageTitle(mode === 'create' ? '友だち情報欄を追加' : '友だち情報欄を編集')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '友だち属性', href: '/tags' }])

  /* R139・R182: 編集では保存済みの既定値を選択肢名へ戻して持つ（IDのまま見せない）。 */
  const stored = field ? storedDefaultLabels(field) : { single: '', multi: [] }
  const [name, setName] = useState(field?.name ?? '')
  const [fieldKey, setFieldKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState<FriendFieldType>(field?.type ?? 'text')
  const [options, setOptions] = useState((field?.options ?? []).join('\n'))
  const [defaultValue, setDefaultValue] = useState(stored.single)
  const [defaultOptions, setDefaultOptions] = useState<string[]>(stored.multi)
  const [isPersonal, setIsPersonal] = useState(field?.isPersonal ?? false)
  const [isStarred, setIsStarred] = useState(field?.isStarred ?? mode === 'create')
  const [ecIsMaster, setEcIsMaster] = useState(field?.ecIsMaster ?? false)
  const [ecFieldPath, setEcFieldPath] = useState(field?.ecFieldPath ?? '')
  const [folderId, setFolderId] = useState(field?.folderId ?? '')
  const [validationError, setValidationError] = useState('')

  const optionList = useMemo(() => options.split('\n').map((value) => value.trim()).filter(Boolean), [options])
  const nameDuplicates = useMemo(
    () => findDuplicateNames(siblings, name, field?.id ?? null),
    [siblings, name, field?.id],
  )
  const keyOwners = useMemo(() => {
    const key = fieldKey.trim()
    if (!key) return []
    return siblings.filter((item) => item.fieldKey === key && item.id !== field?.id).map((item) => item.name)
  }, [siblings, fieldKey, field?.id])

  /*
   * 未保存の番兵（DETAIL-04系）。作る画面は入力がひとつでも入れば未保存、
   * 編集画面は読み込んだ項目との差があれば未保存。
   */
  const dirty = mode === 'create'
    ? Boolean(name || fieldKey || keyTouched || type !== 'text' || options || defaultValue || defaultOptions.length > 0
      || isPersonal || !isStarred || ecIsMaster || ecFieldPath || folderId)
    : field !== null && !locked && (
      name !== field.name
      || options !== (field.options ?? []).join('\n')
      || defaultValue !== stored.single
      || !sameLabels(defaultOptions, stored.multi)
      || isPersonal !== field.isPersonal
      || isStarred !== field.isStarred
      || ecIsMaster !== field.ecIsMaster
      || ecFieldPath !== (field.ecFieldPath ?? '')
      || folderId !== (field.folderId ?? '')
    )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  /* R515: 入力を変えたら次の作成は別の要求として新しいキーにする。 */
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID())
  useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID()
  }, [name, fieldKey, type, folderId, options, defaultValue, defaultOptions, isPersonal, isStarred, ecIsMaster, ecFieldPath])

  const effectiveType = mode === 'edit' && field ? field.type : type
  const destination = folders.find((folder) => folder.id === folderId)?.name ?? '未分類'

  const submit = () => {
    if (saving) return
    if (mode === 'create' && !siblingsReady) return
    if (!name.trim()) return setValidationError('項目名を入力してください')
    if (mode === 'create' && !fieldKey.trim()) return setValidationError('差し込み名を入力してください')
    if (NEEDS_OPTIONS.has(effectiveType) && optionList.length === 0) return setValidationError('選択肢を1つ以上入力してください')
    if (ecIsMaster && !ecFieldPath.trim()) return setValidationError('EC側の項目名を入力してください')
    /* R139: 選択肢から外れた既定値は送る前に止める。 */
    if (effectiveType === 'multi_select') {
      const missing = defaultOptions.filter((item) => !optionList.includes(item))
      if (missing.length > 0) return setValidationError(`既定値の「${missing[0]}」は選択肢にありません。選択肢か既定値を直してください`)
    }
    if (effectiveType === 'select' && defaultValue && !optionList.includes(defaultValue)) {
      return setValidationError(`既定値の「${defaultValue}」は選択肢にありません。選択肢か既定値を直してください`)
    }
    setValidationError('')
    onSubmit({
      name: name.trim(),
      fieldKey: fieldKey.trim(),
      type: effectiveType,
      folderId,
      options: NEEDS_OPTIONS.has(effectiveType) ? optionList : null,
      defaultValue: FILE_TYPES.has(effectiveType)
        ? null
        : effectiveType === 'multi_select'
          ? (defaultOptions.length > 0 ? defaultOptions : null)
          : effectiveType === 'select'
            ? (defaultValue || null)
            : defaultValue.trim() || null,
      isPersonal,
      isStarred,
      ecIsMaster,
      ecFieldPath: ecIsMaster ? ecFieldPath.trim() : '',
    }, idempotencyKeyRef.current)
  }

  const status = saving
    ? (mode === 'create' ? '項目を保存しています' : '保存しています')
    : mode === 'create'
      ? (siblingsReady ? 'まだ保存していません' : '既存の項目を読み直すと保存できます')
      : (locked ? '共通項目は編集できません' : '変更内容を確認して保存してください')

  return (
    <div className={styles.board}>
      <div className={styles.head} data-design="Head">
        <div>
          <h2 className={styles.headTitle}>{mode === 'create' ? '項目を作る' : field?.name ?? '項目を編集'}</h2>
          <p className={styles.headDescription}>
            {mode === 'create' ? '友だち1人ひとりに持たせる情報欄を作ります。' : '名前・フォルダ・値の扱いを変えられます。'}
          </p>
        </div>
      </div>

      {error || validationError ? <Notice tone="danger" message={error || validationError} /> : null}
      {locked ? (
        <Notice tone="warn">
          共通項目はこのアカウントから直接変更できません。新しい項目へ移行してから編集してください。
        </Notice>
      ) : null}

      <div className={styles.split} data-design="Body">
        <div className={styles.main} data-design="Left">
          {/* 段：基本 */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>基本</h2>
            <div className={styles.sectionBody}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>項目名 <RequiredBadge /></span>
                <input
                  className={styles.input}
                  value={name}
                  disabled={locked}
                  onChange={(event) => { setName(event.target.value); if (mode === 'create' && !keyTouched) setFieldKey(suggestKey(event.target.value)) }}
                  placeholder="例：愛犬のお名前"
                />
                <DuplicateNameNote duplicates={nameDuplicates} kindLabel="項目" />
              </div>
              {mode === 'create' ? (
                <>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>差し込み名 <RequiredBadge /></span>
                    <input
                      className={`${styles.input} ${styles.mono}`}
                      value={fieldKey}
                      onChange={(event) => { setKeyTouched(true); setFieldKey(event.target.value) }}
                      placeholder="pet_name"
                    />
                    {keyOwners.length > 0 ? <p className={styles.fieldHint} style={{ color: 'var(--color-warning)' }}>この差し込み名はすでに「{keyOwners[0]}」で使われています。別の差し込み名にしてください。</p> : null}
                  </div>
                  <p className={`${styles.macroPreview} ${styles.mono}`}>{`{{field.${fieldKey || 'pet_name'}}}`}</p>
                </>
              ) : (
                <div>
                  <p className={styles.readonlyLabel}>差し込み名（変更できません）</p>
                  <p className={`${styles.readonlyValue} ${styles.mono}`}>{`{{field.${field?.fieldKey ?? ''}}}`}</p>
                </div>
              )}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>フォルダ</span>
                {foldersState === 'error' ? (
                  <p className={styles.fieldHint}>
                    {mode === 'create' ? 'フォルダを読み込めませんでした。今は未分類にしか入れられません。' : '所属を読み込めませんでした。今の所属は変わらず保存されます。'}
                    {onRetryFolders ? (
                      <button type="button" onClick={onRetryFolders} disabled={foldersReloading} className="ml-1 font-semibold text-status-info hover:underline disabled:opacity-40">
                        {foldersReloading ? '読み込んでいます' : 'もう一度読み込む'}
                      </button>
                    ) : null}
                  </p>
                ) : (
                  <Select
                    aria-label="友だち情報欄のフォルダ"
                    value={folderId}
                    onChange={setFolderId}
                    disabled={locked}
                    size="full"
                    options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
                  />
                )}
                <span className={styles.fieldHint}>フォルダは友だち詳細のタブになります。</span>
              </div>
              <AttributeKindGuide current="field" />
            </div>
          </section>

          {/* 段：種類（作る画面は選ぶカード、編集は読み取り専用） */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <h2 className={styles.sectionTitle}>種類</h2>
                {mode === 'edit' ? <p className={styles.sectionDesc}>種類は変えられません。別の種類にしたいときは一覧の「移行」から新しい項目へ移してください。</p> : null}
              </div>
            </div>
            <div className={styles.sectionBody}>
              {mode === 'create' ? (
                <div className={styles.typeGrid} role="radiogroup" aria-label="項目の種類">
                  {TYPES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      role="radio"
                      aria-checked={type === item}
                      disabled={locked}
                      onClick={() => {
                        setType(item)
                        /* ATTR-07・R139: 種類を変えたら既定値は捨てる（見えない古い値が422で弾かれる）。 */
                        setDefaultValue('')
                        setDefaultOptions([])
                      }}
                      className={`${styles.typeCard} ${type === item ? styles.typeCardOn : ''}`}
                    >
                      <span className={styles.typeCardLabel}>{FIELD_TYPE_LABELS[item]}</span>
                      <span className={styles.typeCardHint}>{FIELD_TYPE_HINTS[item]}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className={styles.readonlyValue}>{FIELD_TYPE_LABELS[effectiveType] ?? effectiveType}</p>
              )}
              {NEEDS_OPTIONS.has(effectiveType) ? (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>選択肢（1行に1つ）</span>
                  <textarea
                    className={styles.textarea}
                    rows={5}
                    value={options}
                    disabled={locked}
                    onChange={(event) => setOptions(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
          </section>

          {/* 段：値の扱い */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>値の扱い</h2>
            <div className={styles.sectionBody}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>既定値</span>
                {/* R139: 複数選択は登録済みの選択肢から複数選ぶ。単一選択は一覧から1つ選ぶ。 */}
                <DefaultValueInput
                  mode={FILE_TYPES.has(effectiveType) ? 'file' : effectiveType === 'multi_select' ? 'multi' : effectiveType === 'select' ? 'single' : effectiveType === 'textarea' ? 'longtext' : 'text'}
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
                <span className={styles.fieldHint}>
                  {FILE_TYPES.has(effectiveType) ? '画像・PDFはファイルとして保存し、本文へ文字として差し込みません。' : '友だち情報が空欄のとき、この値が代わりに送信されます。'}
                </span>
              </div>
              <div>
                <Toggle checked={isStarred} onChange={setIsStarred} disabled={locked} label="友だち一覧に表示" hint="よく見る項目だけを列に追加" />
                <Toggle checked={isPersonal} onChange={setIsPersonal} disabled={locked} label="個人情報として保護" hint="権限制限と閲覧履歴を有効化" />
                <Toggle checked={ecIsMaster} onChange={setEcIsMaster} disabled={locked} label="EC側を正とする" hint="管理画面からの上書きを防ぐ" />
              </div>
              {ecIsMaster ? (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>EC側の項目名</span>
                  <input className={`${styles.input} ${styles.mono}`} value={ecFieldPath} disabled={locked} onChange={(event) => setEcFieldPath(event.target.value)} placeholder="customer.phone" />
                </div>
              ) : null}
            </div>
          </section>
        </div>

        {/* 右の欄 */}
        <div className={styles.side} data-design="Right">
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>出す場所</h2>
            <div className={styles.sectionBody}>
              <dl className={styles.useList}>
                <div className={styles.useRow}>
                  <dt className={styles.useName}>フォルダ</dt>
                  <dd className={styles.useCount}>{destination}</dd>
                </div>
                <div className={styles.useRow}>
                  <dt className={styles.useName}>友だち一覧</dt>
                  <dd className={styles.useCount}>{isStarred ? '出す' : '出さない'}</dd>
                </div>
                <div className={styles.useRow}>
                  <dt className={styles.useName}>テンプレート差し込み</dt>
                  <dd className={styles.useCount}>使える</dd>
                </div>
                {ecIsMaster ? (
                  <div className={styles.useRow}>
                    <dt className={styles.useName}>EC連携</dt>
                    <dd className={styles.useCount}>EC側が正</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </section>

          {mode === 'edit' ? (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>いまの使用状況</h2>
              <div className={styles.sectionBody}>
                <dl className={styles.useList}>
                  <div className={styles.useRow}>
                    <dt className={styles.useName}>値が入っている友だち</dt>
                    <dd className={styles.useCount}>{typeof field?.usageCount === 'number' ? `${field.usageCount}人` : '未集計'}</dd>
                  </div>
                  {field?.displayTargets?.length ? (
                    <div className={styles.useRow}>
                      <dt className={styles.useName}>使用先</dt>
                      <dd className={styles.useCount}>{field.displayTargets.join('・')}</dd>
                    </div>
                  ) : null}
                </dl>
                <p className={styles.noteText}>
                  {field?.isPersonal ? '個人情報として保護されています。見られる・変えられるのは権限のある担当者だけです。' : '個人情報の保護は未設定です。'}
                </p>
              </div>
            </section>
          ) : null}

          <section className={styles.warnCard}>
            <h2 className={styles.warnTitle}>作成後に変更できないもの</h2>
            <p className={styles.warnDesc}>種類と差し込み名は、値やテンプレートを壊さないため固定します。変えたい場合は、新しい項目への移行プレビューを使います。</p>
          </section>
        </div>
      </div>

      <StickyBar
        status={status}
        actions={(
          <>
            <Button onClick={onCancel}>キャンセル</Button>
            <Button variant="primary" disabled={saving || locked || (mode === 'create' && !siblingsReady)} onClick={submit} busy={saving} busyLabel={mode === 'create' ? '作成中…' : '保存中…'}>
              {mode === 'create' ? '項目を作る' : '保存する'}
            </Button>
          </>
        )}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} subject={mode === 'edit' ? '項目への変更' : undefined} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
