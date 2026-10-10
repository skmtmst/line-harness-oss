'use client'

/*
 * ★V8 友だち情報欄を作る・編集（Pencil `w9zY5`）。
 *
 * 型（CreatePage）の左に段「基本」（項目名・差し込みの名前・フォルダ）と段「種類」（よく使う6つの選ぶカード）、
 * 右の列に「種類（つづき）」の札・「値の扱い」（選択肢・既定値）・「オプション」3つの箱と「出す場所」、
 * （編集のみ）「いまの使用状況」。下の帯はキャンセル・保存を真ん中に。
 * 入力・検査・保存の中身は今の部品（app/tags/field-editor-v8.tsx）と同じ。
 * 絵に無い説明（種別の違い・作成後に変えられないもの）は板の頭の「？」へ入れた。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AlignLeft, Calendar, Check, CircleDot, Hash, ListChecks, Star, Type } from 'lucide-react'
import type { FriendField, FriendFieldType, Folder } from '@line-crm/shared'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Notice from '@/components/shared/notice'
import { TextField } from '@/components/shared/text-field'
import { Field } from '@/components/shared/form-controls'
import FolderSelect, { folderById, type FolderSelectCreate } from '@/components/shared/folder-select'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { requestUnsavedAction } from '@/lib/unsaved-action'
import { AttributeKindGuide, DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'
import DefaultValueInput from '@/components/friend-fields/default-value-input'
import { sameLabels, storedDefaultLabels, suggestKey } from './field-model'
import styles from './create.module.css'

/* よく使う 6 つは左の選ぶカード、残りは右の札。 */
const PRIMARY_TYPES: FriendFieldType[] = ['text', 'textarea', 'select', 'multi_select', 'date', 'number']
const SECONDARY_TYPES: FriendFieldType[] = ['datetime', 'time', 'checkbox', 'url', 'tel', 'email', 'image', 'pdf']
export const FIELD_TYPE_WORDS: Record<FriendFieldType, string> = {
  text: '1行テキスト',
  textarea: '文章',
  select: '1つ選ぶ',
  multi_select: 'いくつでも選ぶ',
  date: '日付',
  number: '数',
  datetime: '日時',
  time: '時刻',
  checkbox: 'はい／いいえ',
  url: 'リンク',
  tel: '電話番号',
  email: 'メール',
  image: '画像',
  pdf: 'PDF',
}
const TYPE_HINTS: Partial<Record<FriendFieldType, string>> = {
  text: '名前・番号など',
  textarea: '長い文',
  select: '都道府県など',
  multi_select: '興味のあることなど',
  date: '生年月日など',
  number: '回数・金額など',
}
const TYPE_ICONS: Partial<Record<FriendFieldType, typeof Type>> = {
  text: Type, textarea: AlignLeft, select: CircleDot, multi_select: ListChecks, date: Calendar, number: Hash,
}
/* 「時刻」は保存できるようになった（時刻の口・既定値は HH:MM）。ほかの種類と同じく押して選ぶ。 */
const TYPE_COUNT = PRIMARY_TYPES.length + SECONDARY_TYPES.length
const NEEDS_OPTIONS = new Set<FriendFieldType>(['select', 'multi_select'])
const FILE_TYPES = new Set<FriendFieldType>(['image', 'pdf'])
/* 選択肢は絵のとおり3つの欄から（足すと増える）。 */
const MIN_OPTION_ROWS = 3
const OPTION_EXAMPLES = ['柴', 'トイプードル', 'ミックス']

export interface FieldEditorValues {
  name: string
  fieldKey: string
  type: FriendFieldType
  folderId: string
  options: string[] | null
  /** 統括はラベル変更でも配布済みの選択肢IDを保つ。店の送信値は変えない。 */
  optionIds?: (string | undefined)[]
  defaultValue: string | string[] | null
  isPersonal: boolean
  isStarred: boolean
  ecIsMaster: boolean
  ecFieldPath: string
}

export default function FieldEditor({
  host,
  mode,
  field = null,
  locked = false,
  folders,
  foldersState,
  foldersReloading = false,
  onRetryFolders,
  onCreateFolder,
  siblings,
  siblingsReady,
  saving,
  error,
  notices,
  backHref,
  onCancel,
  onSubmit,
}: {
  host?: { title: string; notice?: ReactNode; footer: (submit: () => void, cancel: () => void) => ReactNode }
  mode: 'create' | 'edit'
  field?: FriendField | null
  locked?: boolean
  folders: Folder[]
  foldersState: 'loading' | 'ready' | 'error'
  foldersReloading?: boolean
  onRetryFolders?: () => void
  /** フォルダを選ぶ欄からその場で作る（dLffh）。閲覧のみ・引き継いだ項目は渡さない。 */
  onCreateFolder?: FolderSelectCreate
  /** 同名・同じ差し込み名の確認に使う既存の項目（IDEA-04）。 */
  siblings: FriendField[]
  /** 既存項目を読めていない間の保存は送らない（R514）。 */
  siblingsReady: boolean
  saving: boolean
  error?: string
  /** 板の上に出す知らせ（読み込み失敗・版の衝突など）。 */
  notices?: ReactNode
  backHref: string
  onCancel: () => void
  /** 作成は第2引数に冪等キーが入る（R515）。編集では使わない。 */
  onSubmit: (values: FieldEditorValues, requestKey: string) => void
}) {
  usePageTitle(host?.title ?? (mode === 'create' ? '項目を作る' : '項目を編集'))
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'タグ', href: host ? '/hq/friend-attributes?tab=fields' : '/tags?tab=fields', onSelect: host ? () => requestUnsavedAction(onCancel) : undefined }])

  /* 編集では保存済みの既定値を選択肢名へ戻して持つ（R139・R182）。 */
  const stored = field ? storedDefaultLabels(field) : { single: '', multi: [] }
  const [name, setName] = useState(field?.name ?? '')
  const [fieldKey, setFieldKey] = useState(host && field ? field.fieldKey : '')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState<FriendFieldType>(field?.type ?? 'text')
  const [options, setOptions] = useState<string[]>(field?.options ?? [])
  const [defaultValue, setDefaultValue] = useState(stored.single)
  const [defaultOptions, setDefaultOptions] = useState<string[]>(stored.multi)
  const [isPersonal, setIsPersonal] = useState(field?.isPersonal ?? false)
  const [isStarred, setIsStarred] = useState(field?.isStarred ?? mode === 'create')
  const [ecIsMaster, setEcIsMaster] = useState(field?.ecIsMaster ?? false)
  const [ecFieldPath, setEcFieldPath] = useState(field?.ecFieldPath ?? '')
  const [folderId, setFolderId] = useState(field?.folderId ?? '')
  const [validationError, setValidationError] = useState('')
  const [validationTarget, setValidationTarget] = useState('')
  const validationRefs = useRef<Record<string, HTMLElement | null>>({})
  const failField = (key: string, message: string) => {
    setValidationTarget(key)
    setValidationError(message)
    const box = validationRefs.current[key]
    const control = box?.matches('input, textarea, button') ? box : box?.querySelector<HTMLElement>('input, textarea, button')
    control?.focus()
    control?.scrollIntoView({ block: 'center' })
  }
  const fieldError = (key: string) => validationTarget === key && validationError
    ? <p className={styles.fieldError} role="alert" id={`ff-error-${key}`}>{validationError}</p> : null
  useEffect(() => { setValidationError(''); setValidationTarget('') }, [name, fieldKey, options, defaultValue, defaultOptions, ecFieldPath])

  const optionList = useMemo(() => options.map((value) => value.trim()).filter(Boolean), [options])
  const nameDuplicates = useMemo(() => findDuplicateNames(siblings, name, field?.id ?? null), [siblings, name, field?.id])
  const keyOwners = useMemo(() => {
    const key = fieldKey.trim()
    if (!key) return []
    return siblings.filter((item) => item.fieldKey === key && item.id !== field?.id).map((item) => item.name)
  }, [siblings, fieldKey, field?.id])

  /* 未保存の番兵：作るは何か入れたら、編集は読み込んだ項目と違えば。 */
  const dirty = mode === 'create'
    ? Boolean(name || fieldKey || keyTouched || type !== 'text' || optionList.length > 0 || defaultValue || defaultOptions.length > 0
      || isPersonal || !isStarred || ecIsMaster || ecFieldPath || folderId)
    : field !== null && !locked && (
      name !== field.name
      || options.join('\n') !== (field.options ?? []).join('\n')
      || defaultValue !== stored.single
      || !sameLabels(defaultOptions, stored.multi)
      || isPersonal !== field.isPersonal
      || isStarred !== field.isStarred
      || ecIsMaster !== field.ecIsMaster
      || ecFieldPath !== (field.ecFieldPath ?? '')
      || folderId !== (field.folderId ?? '')
    )
  const { leaveTarget, confirmLeave, cancelLeave, guarded } = useUnsavedGuard({ dirty, busy: saving })

  /* 入力を変えたら次の作成は別の要求として新しいキーにする（R515）。 */
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID())
  useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID()
  }, [name, fieldKey, type, folderId, options, defaultValue, defaultOptions, isPersonal, isStarred, ecIsMaster, ecFieldPath])

  const effectiveType = mode === 'edit' && field ? field.type : type
  const typeLocked = mode === 'edit' || locked
  const optionsActive = NEEDS_OPTIONS.has(effectiveType) && !locked
  const destination = folders.find((folder) => folder.id === folderId)?.name ?? '未分類'
  const shownKey = mode === 'create' ? (fieldKey.trim() || 'pet_name') : (field?.fieldKey ?? '')

  const selectType = (next: FriendFieldType) => {
    if (typeLocked) return
    setType(next)
    /* 種類を変えたら既定値は捨てる（見えない古い値が 422 で弾かれる。ATTR-07・R139）。 */
    setDefaultValue('')
    setDefaultOptions([])
  }

  const submit = () => {
    if (saving) return
    if (mode === 'create' && !siblingsReady) return
    if (!name.trim()) return failField('name', '項目名を入力してください')
    if (mode === 'create' && !fieldKey.trim()) return failField('key', '差し込みの名前を入力してください')
    if (NEEDS_OPTIONS.has(effectiveType) && optionList.length === 0) return failField('options', '選択肢を1つ以上入力してください')
    if (ecIsMaster && !ecFieldPath.trim()) return failField('ec', 'EC側の項目名を入力してください')
    /* 選択肢から外れた既定値は送る前に止める（R139）。 */
    if (effectiveType === 'multi_select') {
      const missing = defaultOptions.filter((item) => !optionList.includes(item))
      if (missing.length > 0) return failField('default', `既定値の「${missing[0]}」は選択肢にありません。選択肢か既定値を直してください`)
    }
    /* 時刻の既定値は 24 時間の HH:MM（例 09:30）。サーバーと同じ形で送る前に止める。 */
    if (effectiveType === 'time' && defaultValue.trim() && !/^([01]\d|2[0-3]):[0-5]\d$/.test(defaultValue.trim())) {
      return failField('default', '時刻の既定値は「09:30」のように 24 時間の時:分で入力してください')
    }
    if (effectiveType === 'select' && defaultValue && !optionList.includes(defaultValue)) {
      return failField('default', `既定値の「${defaultValue}」は選択肢にありません。選択肢か既定値を直してください`)
    }
    if (mode === 'create' && !/^[a-z][a-z0-9_]{0,31}$/.test(fieldKey.trim())) return failField('key', '差し込みの名前は英小文字で始まる英数字と _ の32文字以内にしてください')
    if (keyOwners.length) return failField('key', 'この差し込みの名前はすでに使われています')
    setValidationTarget(''); setValidationError('')
    onSubmit({
      name: name.trim(),
      fieldKey: fieldKey.trim(),
      type: effectiveType,
      folderId,
      options: NEEDS_OPTIONS.has(effectiveType) ? optionList : null,
      ...(host && NEEDS_OPTIONS.has(effectiveType) ? { optionIds: options.flatMap((value, index) => value.trim() ? [field?.optionDefinitions?.filter((option) => !('status' in option) || option.status !== 'archived')[index]?.id] : []) } : {}),
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

  const optionRows = options.length >= MIN_OPTION_ROWS ? options : [...options, ...Array(MIN_OPTION_ROWS - options.length).fill('')]
  const setOption = (index: number, value: string) => {
    const next = [...optionRows]
    next[index] = value
    setOptions(next)
  }

  const back = <></>
  const help = (
    <>
      <AttributeKindGuide current="field" />
      <p>{host ? '種類と差し込みの名前は、配布先の値を壊さないため作ったあとは変えられません。別の種類は新しいひな形として作ってください。' : '種類と差し込みの名前は、値やテンプレートを壊さないため作ったあとは変えられません。変えたいときは一覧の「…」の「移行」で新しい項目へ移します。'}</p>
    </>
  )

  const aside = (
    <div className={styles.aside}>
      <div className={styles.sideStack}>
        <section className={styles.sideCard} aria-labelledby="ff-more-types">
          <h2 className={styles.sideCardTitle} id="ff-more-types">{`種類（つづき：全${TYPE_COUNT}種）`}</h2>
          <div className={styles.chipColumn} role="radiogroup" aria-label="項目の種類（つづき）">
            {SECONDARY_TYPES.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={effectiveType === item}
                disabled={typeLocked}
                className={styles.typeChip}
                onClick={() => selectType(item)}
              >
                <Star className={styles.typeChipIcon} aria-hidden="true" />
                {FIELD_TYPE_WORDS[item]}
              </button>
            ))}
          </div>
        </section>

        <section className={styles.sideCard} aria-labelledby="ff-values" data-field="options">
          <h2 className={styles.sideCardTitle} id="ff-values">値の扱い</h2>
          <p className={styles.sideNote}>{`「${FIELD_TYPE_WORDS.select}」「${FIELD_TYPE_WORDS.multi_select}」のときは選択肢を並べます。`}</p>
          <div className={styles.optionStack}>
            {optionRows.map((value, index) => (
              <label key={index} className={styles.field}>
                <span className={styles.label}>選択肢</span>
                <TextField
                  ref={index === 0 ? (element) => { validationRefs.current.options = element } : undefined}
                  invalid={index === 0 && validationTarget === 'options' && Boolean(validationError)}
                  aria-describedby={index === 0 && validationTarget === 'options' && validationError ? 'ff-error-options' : undefined}
                  value={value}
                  disabled={!optionsActive}
                  aria-label={`選択肢 ${index + 1}`}
                  placeholder={OPTION_EXAMPLES[index] ?? undefined}
                  onChange={(event) => setOption(index, event.target.value)}
                />
              </label>
            ))}
            {fieldError('options')}
            <span>
              <Button type="button" disabled={!optionsActive} onClick={() => setOptions([...optionRows, ''])}>選択肢を足す</Button>
            </span>
          </div>
          <div className={styles.defaultBox} ref={(element) => { validationRefs.current.default = element }}>
            <Field label="既定値（任意）" htmlFor="ff-default" error={validationTarget === 'default' ? validationError : undefined}>
            {/* 複数選択は登録済みの選択肢から複数選ぶ。単一選択は一覧から1つ選ぶ（R139）。 */}
            <DefaultValueInput
              mode={FILE_TYPES.has(effectiveType) ? 'file' : effectiveType === 'multi_select' ? 'multi' : effectiveType === 'select' ? 'single' : effectiveType === 'textarea' ? 'longtext' : 'text'}
              options={optionList}
              textValue={defaultValue}
              onTextChange={setDefaultValue}
              singleValue={defaultValue}
              onSingleChange={setDefaultValue}
              multiValue={defaultOptions}
              onMultiChange={setDefaultOptions}
              disabled={locked || saving}
              inputId="ff-default"
            />
            </Field>
          </div>
        </section>

        <section className={styles.sideCard} aria-labelledby="ff-options">
          <h2 className={styles.sideCardTitle} id="ff-options">オプション</h2>
          <Checkbox checked={isPersonal} onCheckedChange={setIsPersonal} disabled={locked || saving}>個人情報として保護（画面で伏せる）</Checkbox>
          <Checkbox checked={isStarred} onCheckedChange={setIsStarred} disabled={locked || saving}>友だち一覧の列に出す</Checkbox>
          <Checkbox checked={ecIsMaster} onCheckedChange={setEcIsMaster} disabled={locked || saving}>EC側の値を正とする（EC連携で上書き）</Checkbox>
          {ecIsMaster ? (
            <label className={styles.field} data-field="ec">
              <span className={styles.label}>EC側の項目名</span>
              <TextField ref={(element) => { validationRefs.current.ec = element }} invalid={validationTarget === 'ec' && Boolean(validationError)} aria-describedby={validationTarget === 'ec' && validationError ? 'ff-error-ec' : undefined} value={ecFieldPath} disabled={locked || saving} onChange={(event) => setEcFieldPath(event.target.value)} placeholder="customer.phone" />
              {fieldError('ec')}
            </label>
          ) : null}
        </section>
      </div>

      {host ? null : <>
      <h2 className={styles.asideTitle}>出す場所</h2>
      <dl className={styles.placeList}>
        <div className={styles.placeRow}><dt>友だち詳細</dt><dd title={`いつも出す（${destination}のタブ）`}>いつも出す</dd></div>
        <div className={styles.placeRow}><dt>配信の絞り込み</dt><dd>使える</dd></div>
        <div className={styles.placeRow}><dt>回答フォーム</dt><dd>答えで入れられる</dd></div>
        <div className={styles.placeRow}><dt>テンプレート</dt><dd>差し込みで使える</dd></div>
      </dl>

      </>}
      {!host && mode === 'edit' ? (
        <>
          <h2 className={styles.asideTitle}>いまの使用状況</h2>
          <dl className={styles.placeList}>
            <div className={styles.placeRow}><dt>値が入っている友だち</dt><dd>{typeof field?.usageCount === 'number' ? `${field.usageCount}人` : '未集計'}</dd></div>
            {field?.displayTargets?.length ? <div className={styles.placeRow}><dt>使用先</dt><dd>{field.displayTargets.join('・')}</dd></div> : null}
          </dl>
          <p className={styles.asideText}>{field?.isPersonal ? '個人情報として保護されています。見られる・変えられるのは権限のある担当者だけです。' : '個人情報の保護は未設定です。'}</p>
        </>
      ) : null}
    </div>
  )

  return (
    <>
      <CreatePage
        boardId="w9zY5"
        title={host ? host.title : mode === 'create' ? '項目を作る' : (field?.name ?? '項目を編集')}
        description={host ? '各アカウントへ配る情報欄のひな形を作ります。種類と差し込みの名前は作ったあと変えられません。' : mode === 'create' ? '友だち1人ひとりに持たせる情報欄を作ります。種類は作ったあと「移行」でだけ変えられます' : '名前・フォルダ・値の扱いを変えられます。種類は「移行」でだけ変えられます'}
        help={help}
        identity={host ? undefined : back}
        notice={host?.notice}
        preview={aside}
        footerActions={host ? host.footer(submit, () => guarded(onCancel)) : <>
          <Button type="button" onClick={() => guarded(onCancel)} disabled={saving}>キャンセル</Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving || locked || (mode === 'create' && !siblingsReady)}
            onClick={submit}
            busy={saving}
            busyLabel={mode === 'create' ? '作成中…' : '保存中…'}
          >
            <Check size={15} aria-hidden="true" />
            {mode === 'create' ? '項目を作る' : '保存する'}
          </Button>
        </>}
      >
        {notices}
        {error ? <Notice tone="danger" message={error} /> : null}
        {locked && !host ? <Notice tone="warn">共通項目はこのアカウントから直接変更できません。新しい項目へ移行してから編集してください。</Notice> : null}

        <section className={styles.card} aria-labelledby="ff-basic">
          <div className={styles.cardHead}><h2 className={styles.cardTitle} id="ff-basic">基本</h2></div>
          <label className={styles.field} data-field="name">
            <span className={styles.label}>項目名</span>
            <TextField
              ref={(element) => { validationRefs.current.name = element }}
              invalid={validationTarget === 'name' && Boolean(validationError)}
              aria-describedby={validationTarget === 'name' && validationError ? 'ff-error-name' : undefined}
              value={name}
              disabled={locked || saving}
              aria-required="true"
              placeholder="例：愛犬のお名前"
              onChange={(event) => { setName(event.target.value); if (mode === 'create' && !keyTouched) setFieldKey(suggestKey(event.target.value)) }}
            />
            {fieldError('name')}
            <DuplicateNameNote duplicates={nameDuplicates} kindLabel="項目" />
          </label>
          <div className={styles.field} data-field="key">
            <span className={styles.labelStrong} id="ff-key">{mode === 'create' ? '差し込みの名前（英字）' : '差し込みの名前（変えられません）'}</span>
            <span className={styles.keyRow}>
              <span className={styles.keyBrace}>{'{{field.'}</span>
              {mode === 'create' ? (
                <TextField
                  ref={(element) => { validationRefs.current.key = element }}
                  invalid={validationTarget === 'key' && Boolean(validationError)}
                  aria-describedby={validationTarget === 'key' && validationError ? 'ff-error-key' : undefined}
                  className={styles.keyInput}
                  value={fieldKey}
                  aria-labelledby="ff-key"
                  aria-required="true"
                  placeholder="pet_name"
                  onChange={(event) => { setKeyTouched(true); setFieldKey(event.target.value) }}
                />
              ) : <span className={`${styles.input} ${styles.keyInput} ${styles.keyFixed}`}>{field?.fieldKey}</span>}
              <span className={styles.keyBrace}>{'}}'}</span>
            </span>
            {fieldError('key')}
            {keyOwners.length > 0
              ? <p className={styles.fieldError}>{`この差し込みの名前はすでに「${keyOwners[0]}」で使われています。別の名前にしてください。`}</p>
              : <p className={styles.keyNote}>{`メッセージに {{field.${shownKey}}} と書くと、その人の値に置き換わります`}</p>}
          </div>
          <div className={styles.field}>
            <span className={styles.labelStrong}>フォルダ</span>
            {foldersState === 'error' ? (
              <div className={styles.inlineRetry}>
                <p className={styles.fieldError} role="alert">
                  {mode === 'create' ? 'フォルダを読み込めませんでした。今は未分類にしか入れられません。' : '所属を読み込めませんでした。今の所属は変わらず保存されます。'}
                </p>
                {onRetryFolders ? <Button type="button" variant="text" onClick={onRetryFolders} disabled={foldersReloading}>もう一度読み込む</Button> : null}
              </div>
            ) : (
              <span className={styles.selectBox}>
                <FolderSelect
                  aria-label="友だち情報欄のフォルダ"
                  value={folderId}
                  onChange={setFolderId}
                  disabled={locked || saving}
                  size="full"
                  folders={folders.map(folderById)}
                  onCreate={locked ? undefined : onCreateFolder}
                />
              </span>
            )}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="ff-type">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle} id="ff-type">種類</h2>
            <p className={styles.cardNote}>
              {host ? '種類は作ったあと変えられません。別の種類は新しいひな形として作ってください。' : mode === 'edit' ? '種類は変えられません。別の種類にしたいときは一覧の「移行」から新しい項目へ移してください。' : '作ったあとは「移行」でだけ変えられます'}
            </p>
          </div>
          <div className={styles.typeGrid} role="radiogroup" aria-label="項目の種類（よく使う）">
            {PRIMARY_TYPES.map((item) => {
              const Icon = TYPE_ICONS[item] ?? Type
              return (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={effectiveType === item}
                  disabled={typeLocked}
                  className={styles.typeCard}
                  onClick={() => selectType(item)}
                >
                  <span className={styles.typeCardTop}>
                    <Icon className={styles.wayIcon} aria-hidden="true" />
                    <span className={styles.typeRadio} aria-hidden="true" />
                  </span>
                  <span className={styles.typeCardLabel}>{FIELD_TYPE_WORDS[item]}</span>
                  <span className={styles.typeCardHint}>{TYPE_HINTS[item]}</span>
                </button>
              )
            })}
          </div>
        </section>
      </CreatePage>
      <UnsavedLeaveDialog open={leaveTarget !== null} subject={mode === 'edit' ? '項目への変更' : '入力した項目'} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}
