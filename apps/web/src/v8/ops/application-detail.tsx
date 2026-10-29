'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { api, type OpsApplication } from '@/lib/api'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SectionHeader from '@/components/shared/section-header'
import StatusBadge from '@/components/shared/status-badge'
import { TextArea } from '@/components/shared/text-field'
import { PageFrame } from '@/components/templates/page-frame'
import { OpsHead } from './shell'
import { useOpsReadOnly } from './use-ops-read-only'
import styles from './application-detail.module.css'

const statusLabel: Record<OpsApplication['status'], string> = {
  pending: '未対応', contacted: '連絡中', approved: '承認済み',
  rejected: '見送り', activated: '利用開始済み',
}

export default function OpsApplicationDetail() {
  return <Suspense fallback={<PageFrame kind="detail" boardId="g6NuH" standalone><ListState kind="loading" title="申込を読み込んでいます" /></PageFrame>}><Detail /></Suspense>
}

function Detail() {
  const id = useSearchParams().get('id') ?? ''
  const readOnly = useOpsReadOnly()
  const [application, setApplication] = useState<OpsApplication | null>(null)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!id) { setError('申込が指定されていません'); setLoading(false); return }
    try {
      const result = await api.ops.applications.get(id)
      if (!result.success) throw new Error(result.error || '申込を読み込めませんでした')
      setApplication(result.data)
      setNote(result.data.contact_note || '')
      setError('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '申込を読み込めませんでした') }
    finally { setLoading(false) }
  }, [id])
  useEffect(() => { void load() }, [load])

  const contact = async () => {
    if (!application || busy || !note.trim()) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api.ops.applications.contact(application.id, note.trim())
      if (!result.success) throw new Error(result.error || '保存できませんでした')
      setApplication(result.data); setMessage('連絡内容を保存しました')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存できませんでした') }
    finally { setBusy(false) }
  }

  const approve = async () => {
    if (!application || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api.ops.applications.approve(application.id)
      if (!result.success) throw new Error(result.error || '承認できませんでした')
      setApplication(result.data.application)
      setConfirmOpen(false)
      setMessage(result.data.mailSent ? '承認し、招待メールを送りました' : '承認しました。招待メールの送信に失敗したため、再送してください')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '承認できませんでした') }
    finally { setBusy(false) }
  }

  const resend = async () => {
    if (!application || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api.ops.applications.resendInvite(application.id)
      if (!result.success) throw new Error(result.error || '再送できませんでした')
      setApplication(result.data); setMessage('招待メールを再送しました')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '再送できませんでした') }
    finally { setBusy(false) }
  }

  return <PageFrame kind="detail" boardId="g6NuH" standalone>
    <OpsHead title={application?.company_name ?? '申込の詳細'} description={application ? `受付日 ${new Date(application.created_at).toLocaleString('ja-JP')}` : undefined} />
    <div className={styles.stack}>
      <a href="/ops/applications" className={styles.back}>← 申込アカウントへ戻る</a>
      {error ? <Notice tone="danger" message={error} /> : null}
      {message ? <Notice tone={message.includes('失敗') ? 'warn' : 'success'} message={message} /> : null}
      {loading ? <ListState kind="loading" title="申込を読み込んでいます" /> : !application ? <ListState kind="error" title="申込を表示できませんでした" description={error} onRetry={() => void load()} /> : <>
        <div className={styles.heading}><StatusBadge tone={application.status === 'activated' ? 'success' : application.status === 'contacted' ? 'warning' : 'neutral'}>{statusLabel[application.status]}</StatusBadge></div>
        <div className={styles.columns}>
          <Card contentPadding="var(--polish-space-section)" layout="vertical" gap="normal">
            <SectionHeader title="申込内容" />
            <dl className={styles.fields}>
              <div><dt>会社名</dt><dd>{application.company_name}</dd></div>
              <div><dt>担当者名</dt><dd>{application.contact_name}</dd></div>
              <div><dt>メールアドレス</dt><dd>{application.email}</dd></div>
              <div><dt>電話番号</dt><dd>{application.phone}</dd></div>
              <div><dt>musuboを知ったきっかけ</dt><dd>{application.referral_source}</dd></div>
              <div><dt>申込日時</dt><dd>{new Date(application.created_at).toLocaleString('ja-JP')}</dd></div>
            </dl>
          </Card>
          <Card contentPadding="var(--polish-space-section)" layout="vertical" gap="normal">
            <SectionHeader title="対応状況" />
            <ol className={styles.steps}>
              <li>申込受付 <span>完了</span></li>
              <li>担当者から連絡 <span>{application.contacted_at ? '完了' : '未対応'}</span></li>
              <li>承認・招待メール <span>{application.invite_sent_at ? '送信済み' : application.approved_at ? '送信待ち' : '未対応'}</span></li>
              <li>利用開始 <span>{application.tenant_id ? '完了' : '未対応'}</span></li>
            </ol>
            {application.invite_sent_at ? <p className={styles.muted}>招待メール送信：{new Date(application.invite_sent_at).toLocaleString('ja-JP')}</p> : null}
          </Card>
        </div>
        <Card contentPadding="var(--polish-space-section)" layout="vertical" gap="normal">
          <SectionHeader title="担当者からの連絡メモ" />
          <label htmlFor="application-contact-note">連絡内容・メモ</label>
          <TextArea id="application-contact-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder="電話・メールで確認した内容を記録" readOnly={readOnly || !['pending', 'contacted'].includes(application.status)} />
          {!readOnly && ['pending', 'contacted'].includes(application.status) ? <div className={styles.actions}><Button onClick={() => void contact()} disabled={!note.trim() || busy}>連絡済みとして保存</Button></div> : null}
        </Card>
        {application.status === 'contacted' && !readOnly ? <div className={styles.actions}><Button variant="primary" onClick={() => setConfirmOpen(true)} disabled={busy}>承認して招待メールを送る</Button></div> : null}
        {application.status === 'approved' && !readOnly ? <div className={styles.actions}><Button onClick={() => void resend()} disabled={busy}>{application.invite_sent_at ? '招待メールを再送' : '招待メールを送る'}</Button></div> : null}
      </>}
    </div>
    <Dialog open={confirmOpen} title="この申込を承認しますか？" description="承認すると、申込者に利用開始のご案内を送ります。初期設定が完了するまではログインできません。" confirmLabel="承認して招待を送る" onConfirm={() => void approve()} onCancel={() => setConfirmOpen(false)} busy={busy} designNode="SVAtm" confirmation>
      <dl className={styles.fields}>
        <div><dt>会社名</dt><dd>{application?.company_name}</dd></div>
        <div><dt>招待メール送信先</dt><dd>{application?.email}</dd></div>
      </dl>
      <p className={styles.muted}>申込内容と連絡記録を確認してから進めてください。</p>
    </Dialog>
  </PageFrame>
}
