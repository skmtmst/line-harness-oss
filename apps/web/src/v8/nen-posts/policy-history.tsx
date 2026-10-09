'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type PhotoRewardPolicyVersion } from '@/lib/api'
import Button from '@/components/shared/button'
import StatusBadge from '@/components/shared/status-badge'
import Dialog from '@/components/shared/dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import VersionCompare from '@/components/shared/version-compare'
import { TextField } from '@/components/shared/text-field'
import { FieldError } from '@/components/shared/form-controls'
import { useFieldValidation } from '@/lib/use-field-validation'
import DateTimeField from '@/components/shared/date-time-field'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { formatPhotoReceivedAt } from './time'
import styles from './review.module.css'
import { Field } from '@/components/shared/form-controls'

const policyContent = (version: PhotoRewardPolicyVersion) => `採用 ${version.points}・公式サイト掲載 ${version.publicationPoints ? `さらに ${version.publicationPoints}` : 'なし'}`

/** 版の日時は「9/20 10:00」の短い形（日本時間）。全文は title で読める。 */
function shortWhen(value: string | null | undefined): string {
  const time = Date.parse(String(value ?? ''))
  if (!Number.isFinite(time)) return '—'
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}

/** N1br7.html の表＋予約中の版＋新しい版の入力。保存は既存の版APIへ送る。 */
export default function PhotoPolicyHistoryV8({ open, canEdit, onClose, onChanged }: {
  open: boolean; canEdit: boolean; onClose: () => void; onChanged: () => void
}) {
  const [versions, setVersions] = useState<PhotoRewardPolicyVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<PhotoRewardPolicyVersion | null>(null)
  const [points, setPoints] = useState('')
  const [publicationPoints, setPublicationPoints] = useState('0')
  const [summary, setSummary] = useState('')
  const [effective, setEffective] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [revertOpen, setRevertOpen] = useState(false)
  const value = Number(points)
  const publicationValue = Number(publicationPoints)
  const fields = useFieldValidation([
    ...(!Number.isInteger(value) || value < 1 || value > 100000
      ? [{ id: 'photo-policy-points', message: '採用したら付けるマイルを1〜100000で入力してください。' }] : []),
    ...(!Number.isInteger(publicationValue) || publicationValue < 0 || publicationValue > 100000
      ? [{ id: 'photo-policy-publication', message: '掲載時の追加マイルを0〜100000で入力してください。' }] : []),
    ...(effective && !Number.isFinite(Date.parse(effective))
      ? [{ id: 'photo-policy-effective', message: '使い始めの日時を確認してください。' }] : []),
  ])
  const current = versions.find((version) => version.status === 'in_use')
  const reserved = versions.filter((version) => version.status === 'reserved')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await api.nenMembers.photoRewardPolicyVersions()
      if (!response.success) throw new Error(response.error)
      setVersions(response.data)
    } catch { setError('報酬の決まりを読み込めませんでした。') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { if (open) void load() }, [open, load])
  const save = async () => {
    if (!canEdit || saving) return
    setSaveError('')
    if (!fields.submit()) return
    setSaving(true); setSaveError('')
    try {
      const response = await api.nenMembers.createPhotoRewardPolicyVersion({
        points: value, publicationPoints: publicationValue, summary: summary.trim(),
        effectiveFrom: effective ? `${effective}:00+09:00` : null,
        ...(versions.length ? { expectedVersion: Math.max(...versions.map((version) => version.versionNumber)) } : {}),
      })
      if (!response.success) throw new Error(response.error)
      setPoints(''); setPublicationPoints('0'); setSummary(''); setEffective(''); fields.reset(); await load(); onChanged()
    } catch { setSaveError('新しい版を保存できませんでした。最新の版を読み直して、もう一度お試しください。') }
    finally { setSaving(false) }
  }
  const revert = async () => {
    if (!selected || !canEdit || saving) return
    setSaving(true); setSaveError('')
    try {
      const response = await api.nenMembers.revertPhotoRewardPolicyVersion({ versionNumber: selected.versionNumber })
      if (!response.success) throw new Error(response.error)
      setRevertOpen(false); setSelected(null); await load(); onChanged()
    } catch { setSaveError('この版に戻せませんでした。もう一度お試しください。') }
    finally { setSaving(false) }
  }
  return <>
    <Dialog open={open} designNode="N1br7" designWidth={640} designTop={220} title="版の履歴（報酬の決まり）" description="保存するたびに版が1つ増えます。前の版は変わりません。「この版に戻す」は、その中身で新しい版を作ります。" busy={saving} onCancel={onClose} footer={<div className={styles.dialogFoot}><Button variant="secondary" disabled={saving} onClick={onClose}>閉じる</Button></div>}>
      <div className={styles.dialogStack}>
      {loading ? <ListState kind="loading" title="版を読み込んでいます" /> : error ? <ListState kind="error" title={error} onRetry={() => void load()} /> : <>
        <div className={styles.historyTable}><DataTable><thead><TableHeadRow><Th>版</Th><Th>保存日時</Th><Th>保存した人</Th><Th>内容</Th><Th><span className="sr-only">操作</span></Th></TableHeadRow></thead><tbody>
          {versions.filter((version) => version.status !== 'reserved').map((version) => <Tr key={version.versionNumber}>
            <Td>{`v${version.versionNumber}`}</Td><Td><span title={formatPhotoReceivedAt(version.createdAt)}>{shortWhen(version.createdAt)}</span></Td><Td>{version.createdBy || '—'}</Td><Td>{policyContent(version)}</Td>
            <Td>{version.status === 'in_use' ? <StatusBadge tone="success">いま使っている版</StatusBadge> : <Button variant="secondary" onClick={() => setSelected(version)}>比べる</Button>}</Td>
          </Tr>)}
        </tbody></DataTable></div>
        {selected && current ? <section className={styles.historyCompare}><h3 className={styles.fieldTitle}>{`いま使っている版とv${selected.versionNumber}を比べる`}</h3><VersionCompare before={`${policyContent(current)}\n${current.summary}`} after={`${policyContent(selected)}\n${selected.summary}`} />{canEdit ? <div className={styles.historyActions}><Button variant="secondary" onClick={() => setRevertOpen(true)}>この版に戻す</Button></div> : null}</section> : null}
        <p className={styles.historyHint}>過去の版は変わりません。その中身で新しい版を作ります。採用済みの付与は、そのときの版のまま変わりません。</p>
        <div className={styles.historyColumns}>
          <section className={styles.historyCard}>
            <h3 className={styles.railTitle}>予約中の版</h3>
            {reserved.length ? reserved.map((version) => <div key={version.versionNumber} className={styles.historyReserved}>
              <p className={styles.historyReservedHead}><strong>{`v${version.versionNumber}`}</strong><StatusBadge tone="info">予約</StatusBadge><span className={styles.historyReservedWhen} title={version.effectiveFrom ? formatPhotoReceivedAt(version.effectiveFrom) : undefined}>{version.effectiveFrom ? `${shortWhen(version.effectiveFrom)} から` : '—'}</span></p>
              <p className={styles.historyReservedBody}>{policyContent(version)}</p>
            </div>) : <p className={styles.railNote}>予約中の版はありません</p>}
          </section>
          {canEdit ? <form className={styles.historyCard} onSubmit={(event) => { event.preventDefault(); void save() }}>
            <h3 className={styles.railTitle}>引き出し：新しい版を作る</h3>
            <p className={styles.historyLead}>保存しても、使い始めの日時までは今の版のままです。</p>
            <div className={styles.historyFields}><Field label="採用したら（マイル）"><TextField {...fields.bind('photo-policy-points')} aria-label="採用したら（マイル）" inputMode="numeric" value={points} onChange={(event) => setPoints(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} disabled={saving} />
<FieldError id="photo-policy-points-error">{fields.error('photo-policy-points')}</FieldError></Field>
              <Field label="掲載されたら（さらに）"><TextField {...fields.bind('photo-policy-publication')} aria-label="掲載されたら（さらに）" inputMode="numeric" value={publicationPoints} onChange={(event) => setPublicationPoints(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} disabled={saving} />
<FieldError id="photo-policy-publication-error">{fields.error('photo-policy-publication')}</FieldError></Field></div>
            <Field label="ひとこと（なぜ変えるか）"><TextField value={summary} maxLength={200} disabled={saving} onChange={(event) => setSummary(event.target.value)} /></Field>
            <div className={styles.inputLabel} title="日本時間。空ならすぐ使い始めます。"><span aria-hidden="true">使い始め</span><DateTimeField id="photo-policy-effective" aria-describedby={fields.error('photo-policy-effective') ? 'photo-policy-effective-error' : undefined} invalid={Boolean(fields.error('photo-policy-effective'))} aria-label="使い始め（日本時間・空ならすぐ）" placeholder="空ならすぐ" value={effective} disabled={saving} onChange={setEffective} /><FieldError id="photo-policy-effective-error">{fields.error('photo-policy-effective')}</FieldError></div>
            {saveError ? <p role="alert" className={styles.errorText}>{saveError}</p> : null}
            <div className={styles.historyActions}><Button variant="secondary" disabled={saving} onClick={() => { setPoints(''); setPublicationPoints('0'); setSummary(''); setEffective(''); setSaveError(''); fields.reset() }}>キャンセル</Button><Button type="submit" variant="primary" busy={saving} disabled={saving}>{effective ? '版を予約する' : '版を保存する'}</Button></div>
          </form> : null}
        </div>
      </>}
      </div>
    </Dialog>
    <ConfirmDialog open={revertOpen} title={`v${selected?.versionNumber}に戻しますか？`} description="過去の版は変わりません。その中身で新しい版を作ります。付与済みのマイルは変わりません。" busy={saving} error={saveError} confirmLabel="この版に戻す" onConfirm={() => void revert()} onCancel={() => { if (!saving) setRevertOpen(false) }} />
  </>
}
