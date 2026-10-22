'use client'
import { notifySaved } from '@/components/shared/toast'
import { FormLeaveGuard } from '@/components/shared/form-leave-guard'
import { useEffect, useId, useState, useRef, useImperativeHandle, type FormEvent } from 'react'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import { TextField } from '@/components/shared/text-field'
import Notice from '@/components/shared/notice'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { api } from '@/lib/api'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import HqSettingsNavV8, { useHqSettingsFolderNav } from './settings-nav'
import CompanyContactCard from './company-contact'
import styles from './settings.module.css'
import { Field } from '@/components/shared/form-controls'
import { emptyValue } from '@/components/shared/empty-value'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import { PageFooter } from '@/components/templates/page-footer'
import type { SettingsDraft, SettingsDraftProps } from './settings-draft'
import ReadOnlyNotice from '@/components/shared/read-only-notice'

/*
 * ★V8 統括の情報（Pencil ）。
 *
 * 管理画面 の画面（app/hq/settings/page.tsx）と読み書きの口・権限・失敗時の扱いは同じ。
 * 見た目だけを絵どおりに一から組んだ：頭（型 ListPage）・左の「統括の設定」の列
 * （型のフォルダの列。板が狭いときは型が「設定：〇〇」の選ぶ欄に畳む）・統括名のカード。
 * 絵の「運営による操作」は契約先には出さない（2026-10-06 利用者指定。管理画面 と同じ）。
 */

const TITLE = '統括の情報'
const DESCRIPTION = '統括の名前です。各アカウントの画面の上と、メンバーへの招待メールに出ます。'

export default function HqSettingsV8() {
  // ★V8 上の帯のパンくずは「ホーム › 統括の設定 › 画面名」。
  usePageTitle(TITLE)
  usePageCrumbs([{ label: '統括の設定', href: '/hq/settings' }])
  const settingsNav = useHqSettingsFolderNav('info')
  /* 役割はサーバ（/api/staff/me）から読む。変えられるのはオーナーと管理者だけ。 */
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const nameDraft = useRef<SettingsDraft>(null)
  const contactDraft = useRef<SettingsDraft>(null)
  const [nameDirty, setNameDirty] = useState(false)
  const [contactDirty, setContactDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const saveAll = async () => {
    if (!canEdit || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      for (const draft of [nameDraft, contactDraft]) {
        if (draft.current?.dirty && !await draft.current.save()) break
      }
    } finally { savingRef.current = false; setSaving(false) }
  }


  return (
    <ListPage boardId="K7HYu" title={TITLE} help={DESCRIPTION} folders={<HqSettingsNavV8 active="info" />} folderWidth={200} folderNav={settingsNav}>
      <FormLeaveGuard dirty={canEdit && (nameDirty || contactDirty)} busy={saving} />
      <div className={styles.body}>
        {role && !canEdit ? <ReadOnlyNotice >閲覧のみで見ています。統括名の変更と会社・連絡先の登録は管理者だけができます。</ReadOnlyNotice> : null}
        <TenantNameCard canEdit={canEdit} draftRef={nameDraft} onDirtyChange={setNameDirty} locked={saving} />
        {canEdit ? <CompanyContactCard canEdit draftRef={contactDraft} onDirtyChange={setContactDirty} locked={saving} /> : null}
      </div>
      {canEdit && (nameDirty || contactDirty || saving) ? <PageFooter status="変更した項目を保存します" actions={<><Button disabled={saving} onClick={() => { nameDraft.current?.reset(); contactDraft.current?.reset() }}>キャンセル</Button><Button variant="primary" disabled={saving} busy={saving} onClick={() => void saveAll()}>保存する</Button></>} /> : null}
    </ListPage>
  )
}

/** 統括名のカード（共通の入力段・間12）。 */
function TenantNameCard({ canEdit, draftRef, onDirtyChange, locked }: { canEdit: boolean } & SettingsDraftProps) {
  const saveErrors = useSaveFormErrors()
  const uid = useId()
  const [name, setName] = useState('')
  const [baseline, setBaseline] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.tenants.me()
      .then((response) => {
        if (!response.success) throw new Error(response.error)
        if (!cancelled) { setName(response.data.name ?? ''); setBaseline(response.data.name ?? ''); setReady(true) }
      })
      .catch(() => {
        if (!cancelled) setError('統括名を読み込めませんでした。時間をおいてもう一度お試しください。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const save = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!canEdit || loading || saving || !ready) return false
    if (!dirty) return true
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 100) {
      setNameError(!trimmed ? '統括名を入力してください。' : '統括名は100文字以内で入力してください。')
      setError('')
      const input = document.getElementById(`${uid}-name`)
      input?.focus()
      input?.scrollIntoView?.({ block: 'center' })
      return false
    }
    setNameError('')
    setSaving(true)
    setError('')
    try {
      const response = await api.tenants.updateName(trimmed)
      if (!response.success) throw new Error(response.error)
      setName(response.data.name ?? trimmed)
      setBaseline(response.data.name ?? trimmed)
      notifySaved('統括名を保存しました。')
      return true
    } catch (caught) {
      const fieldFailure = saveErrors.capture(caught)
      // M026：再試行の言葉がない代替文にしない。共通の状態別案内へ渡す。
      { if (!fieldFailure)

      setError(japaneseDetailOf(caught) || describeApiFailure(caught, '統括名の保存', {
        scope: 'hq',
      })) }
      return false
    } finally {
      setSaving(false)
    }
  }

  const dirty = ready && name.trim() !== baseline
  const reset = () => { setName(baseline); setNameError(''); setError(''); saveErrors.reset() }
  useImperativeHandle(draftRef, () => ({ dirty, save, reset }))
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  if (!canEdit) {
    return (
      <SaveErrorScope errors={saveErrors}><Card variant="form" gap="normal" aria-label="統括名">
        <dl className={styles.field}>
          <dt className={styles.label}>統括名</dt>
          <dd className={styles.value}>{loading ? '読み込んでいます…' : error ? '読み込めませんでした' : name || emptyValue('unknown')}</dd>
        </dl>
        {error ? <Notice tone="danger" >{error}</Notice> : null}
        <p className={styles.hint}>統括名の変更は管理者だけができます。</p>
      </Card></SaveErrorScope>
    )
  }

  return (
    <SaveErrorScope errors={saveErrors}><form onSubmit={save} className={styles.form}><Card variant="form" gap="normal">
      <div className={styles.field}><Field label="統括名" htmlFor={`${uid}-name`}><SaveErrorField names={["name"]}><TextField
          id={`${uid}-name`}
          value={name}
          maxLength={100}
          disabled={loading || saving || locked || !ready}
          onChange={(event) => { setName(event.target.value); setNameError('') }}
          invalid={Boolean(nameError)}
          aria-describedby={nameError ? `${uid}-name-error` : undefined}
          className={styles.full}
        /></SaveErrorField>
{nameError ? <p id={`${uid}-name-error`} className={styles.error} role="alert">{nameError}</p> : null}</Field></div>
      <p className={styles.hint}>会社名やブランド名など、メンバーが見てわかる名前にします</p>
      {error ? <Notice tone="danger" >{error}</Notice> : null}
      {null}

    </Card></form></SaveErrorScope>
  )
}
