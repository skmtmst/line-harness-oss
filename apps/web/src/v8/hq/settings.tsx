'use client'
import { notifySaved } from '@/components/shared/toast'
import { FormLeaveGuard } from '@/components/shared/form-leave-guard'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import { TextField } from '@/components/shared/text-field'
import Notice from '@/components/shared/notice'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { api } from '@/lib/api'
import { useStaffRole } from '@/lib/staff-role'
import HqSettingsNavV8, { useHqSettingsFolderNav } from './settings-nav'
import CompanyContactCard from './company-contact'
import styles from './settings.module.css'
import { Field } from '@/components/shared/form-controls'
import { emptyValue } from '@/components/shared/empty-value'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'


/*
 * ★V8 統括の情報（Pencil `K7HYu`）。
 *
 * v7 の画面（app/hq/settings/page.tsx）と読み書きの口・権限・失敗時の扱いは同じ。
 * 見た目だけを絵どおりに一から組んだ：頭（型 ListPage）・左の「統括の設定」の列
 * （型のフォルダの列。板が狭いときは型が「設定：〇〇」の選ぶ欄に畳む）・統括名のカード。
 * 絵の「運営による操作」は契約先には出さない（2026-10-06 利用者指定。v7 と同じ）。
 */

const TITLE = '統括の情報'
const DESCRIPTION = '統括の名前です。各アカウントの画面の上と、メンバーへの招待メールに出ます。'

export default function HqSettingsV8() {
  // ★V8 上の帯のパンくずは「ホーム › 統括の設定 › 画面名」（絵 `V8-B/K7HYu`）。
  usePageTitle(TITLE)
  usePageCrumbs([{ label: '統括の設定', href: '/hq/settings' }])
  const settingsNav = useHqSettingsFolderNav('info')
  /* 役割はサーバ（/api/staff/me）から読む。変えられるのはオーナーと管理者だけ。 */
  const role = useStaffRole()
  const canEdit = role === 'owner' || role === 'admin'

  return (
    <ListPage boardId="K7HYu" title={TITLE} help={DESCRIPTION} folders={<HqSettingsNavV8 active="info" />} folderNav={settingsNav}>
      <div className={styles.body}>
        {role && !canEdit ? <Notice tone="info">閲覧のみで見ています。統括名の変更と会社・連絡先の登録は管理者だけができます。</Notice> : null}
        <TenantNameCard canEdit={canEdit} />
        {canEdit ? <CompanyContactCard canEdit /> : null}
      </div>
    </ListPage>
  )
}

/** 統括名のカード（角丸12・余白20・間12）。 */
function TenantNameCard({ canEdit }: { canEdit: boolean }) {
  const saveErrors = useSaveFormErrors()
  const uid = useId()
  const [name, setName] = useState('')
  const [baseline, setBaseline] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.tenants.me()
      .then((response) => {
        if (!cancelled && response.success) { setName(response.data.name ?? ''); setBaseline(response.data.name ?? '') }
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
    const trimmed = name.trim()
    setSaved(false)
    if (!trimmed || trimmed.length > 100) {
      setNameError(!trimmed ? '統括名を入力してください。' : '統括名は100文字以内で入力してください。')
      setError('')
      const input = document.getElementById(`${uid}-name`)
      input?.focus()
      input?.scrollIntoView?.({ block: 'center' })
      return
    }
    setNameError('')
    setSaving(true)
    setError('')
    try {
      const response = await api.tenants.updateName(trimmed)
      if (!response.success) throw new Error(response.error)
      setName(response.data.name ?? trimmed)
      setBaseline(response.data.name ?? trimmed)
      setSaved(true); notifySaved()
    } catch (caught) {
      const fieldFailure = saveErrors.capture(caught)
      // M026：再試行の言葉がない代替文にしない。共通の状態別案内へ渡す。
      { if (!fieldFailure)

      setError(japaneseDetailOf(caught) || describeApiFailure(caught, '統括名の保存', {
        scope: 'hq',
      })) }
    } finally {
      setSaving(false)
    }
  }

  if (!canEdit) {
    return (
      <SaveErrorScope errors={saveErrors}><section className={styles.card} aria-label="統括名">
        <dl className={styles.field}>
          <dt className={styles.label}>統括名</dt>
          <dd className={styles.value}>{loading ? '読み込んでいます…' : error ? '読み込めませんでした' : name || emptyValue('unknown')}</dd>
        </dl>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <p className={styles.hint}>統括名の変更は管理者だけができます。</p>
      </section></SaveErrorScope>
    )
  }

  return (
    <SaveErrorScope errors={saveErrors}><form onSubmit={save} className={styles.card}>
      <FormLeaveGuard dirty={name !== baseline} busy={saving} />
      <div className={styles.field}><Field label="統括名" htmlFor={`${uid}-name`}><SaveErrorField names={["name"]}><TextField
          id={`${uid}-name`}
          value={name}
          maxLength={100}
          disabled={loading || saving}
          onChange={(event) => { setName(event.target.value); setSaved(false); setNameError('') }}
          invalid={Boolean(nameError)}
          aria-describedby={nameError ? `${uid}-name-error` : undefined}
          className={styles.full}
        /></SaveErrorField>
{nameError ? <p id={`${uid}-name-error`} className={styles.error} role="alert">{nameError}</p> : null}</Field></div>
      <p className={styles.hint}>会社名やブランド名など、メンバーが見てわかる名前にします</p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {null}
      <div className={styles.actions}>
        <Button variant="primary" type="submit" disabled={loading || saving} busy={saving}>統括名を保存する</Button>
      </div>
    </form></SaveErrorScope>
  )
}
