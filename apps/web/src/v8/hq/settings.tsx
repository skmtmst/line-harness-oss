'use client'

/*
 * ★V8 統括の情報（Pencil `K7HYu`）。
 *
 * v7 の画面（app/hq/settings/page.tsx）と読み書きの口・権限・失敗時の扱いは同じ。
 * 見た目だけを絵どおりに一から組んだ：頭（型 ListPage）・左の「統括の設定」の列
 * （型のフォルダの列。板が狭いときは型が「設定：〇〇」の選ぶ欄に畳む）・統括名のカード。
 * 絵の「運営による操作」は契約先には出さない（2026-10-06 利用者指定。v7 と同じ）。
 */
import { useEffect, useId, useState, type FormEvent } from 'react'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import { TextField } from '@/components/shared/text-field'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { api } from '@/lib/api'
import { useStaffRole } from '@/lib/staff-role'
import HqSettingsNavV8, { useHqSettingsFolderNav } from './settings-nav'
import styles from './settings.module.css'

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
    <ListPage boardId="K7HYu" title={TITLE} description={DESCRIPTION} folders={<HqSettingsNavV8 active="info" />} folderNav={settingsNav}>
      <div className={styles.body}>
        <TenantNameCard canEdit={canEdit} />
      </div>
    </ListPage>
  )
}

/** 統括名のカード（角丸12・余白20・間12）。 */
function TenantNameCard({ canEdit }: { canEdit: boolean }) {
  const uid = useId()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.tenants.me()
      .then((response) => {
        if (!cancelled && response.success) setName(response.data.name ?? '')
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
    if (!trimmed) return setError('統括名を入力してください。')
    if (trimmed.length > 100) return setError('統括名は100文字以内で入力してください。')
    setSaving(true)
    setError('')
    try {
      const response = await api.tenants.updateName(trimmed)
      if (!response.success) throw new Error(response.error)
      setName(response.data.name ?? trimmed)
      setSaved(true)
    } catch (caught) {
      // M026：再試行の言葉がない代替文にしない。共通の状態別案内へ渡す。
      setError(japaneseDetailOf(caught) || describeApiFailure(caught, '統括名の保存', {
        forbidden: '統括名の変更は管理者だけができます。必要なときは管理者の方に操作してもらってください。',
      }))
    } finally {
      setSaving(false)
    }
  }

  if (!canEdit) {
    return (
      <section className={styles.card} aria-label="統括名">
        <dl className={styles.field}>
          <dt className={styles.label}>統括名</dt>
          <dd className={styles.value}>{loading ? '読み込んでいます…' : error ? '読み込めませんでした' : name || '—'}</dd>
        </dl>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <p className={styles.hint}>統括名の変更は管理者だけができます。</p>
      </section>
    )
  }

  return (
    <form onSubmit={save} className={styles.card}>
      <div className={styles.field}>
        <label htmlFor={`${uid}-name`} className={styles.label}>統括名</label>
        <TextField
          id={`${uid}-name`}
          value={name}
          maxLength={100}
          disabled={loading || saving}
          onChange={(event) => { setName(event.target.value); setSaved(false) }}
          className={styles.full}
        />
      </div>
      <p className={styles.hint}>会社名やブランド名など、メンバーが見てわかる名前にします</p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {saved ? <p className={styles.saved} role="status">保存しました。</p> : null}
      <div className={styles.actions}>
        <Button variant="primary" type="submit" disabled={loading || saving} busy={saving}>統括名を保存する</Button>
      </div>
    </form>
  )
}
