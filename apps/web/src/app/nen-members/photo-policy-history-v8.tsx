'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type PhotoRewardPolicyVersion } from '@/lib/api'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import VersionCompare from '@/components/shared/version-compare'
import { TextField } from '@/components/shared/text-field'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { formatPhotoReceivedAt } from './photo-review-time'
import styles from './photo-review-v8.module.css'

const policyContent = (version: PhotoRewardPolicyVersion) => `採用 ${version.points} マイル・公式サイト掲載 さらに ${version.publicationPoints ?? 0} マイル`

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
    const value = Number(points)
    if (!Number.isInteger(value) || value < 1 || value > 100000) { setSaveError('採用したら付けるマイルを1〜100000で入力してください。'); return }
    const publicationValue = Number(publicationPoints)
    if (!Number.isInteger(publicationValue) || publicationValue < 0 || publicationValue > 100000) { setSaveError('掲載時の追加マイルを0〜100000で入力してください。'); return }
    if (effective && !Number.isFinite(Date.parse(effective))) { setSaveError('使い始めの日時を確認してください。'); return }
    setSaving(true); setSaveError('')
    try {
      const response = await api.nenMembers.createPhotoRewardPolicyVersion({
        points: value, publicationPoints: publicationValue, summary: summary.trim(),
        effectiveFrom: effective ? `${effective}:00+09:00` : null,
        ...(versions.length ? { expectedVersion: Math.max(...versions.map((version) => version.versionNumber)) } : {}),
      })
      if (!response.success) throw new Error(response.error)
      setPoints(''); setPublicationPoints('0'); setSummary(''); setEffective(''); await load(); onChanged()
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
    <Dialog open={open} designNode="N1br7" title="版の履歴（報酬の決まり）" description="保存するたびに版が1つ増えます。前の版は変わりません。「この版に戻す」は、その中身で新しい版を作ります。" busy={saving} onCancel={onClose} footer={<div className={styles.dialogFoot}><Button variant="secondary" disabled={saving} onClick={onClose}>閉じる</Button></div>}>
      <span className={styles.historyAnchor} aria-hidden="true" />
      {loading ? <ListState kind="loading" title="版を読み込んでいます" /> : error ? <ListState kind="error" title={error} onRetry={() => void load()} /> : <>
        <div className={styles.historyTable}><DataTable><thead><TableHeadRow><Th>版</Th><Th>保存日時</Th><Th>保存した人</Th><Th>内容</Th><Th>操作</Th></TableHeadRow></thead><tbody>
          {versions.filter((version) => version.status !== 'reserved').map((version) => <Tr key={version.versionNumber}>
            <Td>v{version.versionNumber}</Td><Td>{formatPhotoReceivedAt(version.createdAt)}</Td><Td>{version.createdBy || '—'}</Td><Td>{policyContent(version)}</Td>
            <Td>{version.status === 'in_use' ? <Chip tone="ok">いま使っている版</Chip> : <Button variant="secondary" onClick={() => setSelected(version)}>比べる</Button>}</Td>
          </Tr>)}
        </tbody></DataTable></div>
        {selected && current ? <section className={styles.historyCompare}><h3>いま使っている版とv{selected.versionNumber}を比べる</h3><VersionCompare before={`${policyContent(current)}\n${current.summary}`} after={`${policyContent(selected)}\n${selected.summary}`} />{canEdit ? <Button variant="secondary" onClick={() => setRevertOpen(true)}>この版に戻す</Button> : null}</section> : null}
        <p className={styles.historyHint}>過去の版は変わりません。その中身で新しい版を作ります。採用済みの付与は、そのときの版のまま変わりません。</p>
        <div className={styles.historyColumns}>
          <section className={styles.railCard}><h3 className={styles.railTitle}>予約中の版</h3>{reserved.length ? reserved.map((version) => <div key={version.versionNumber}><p>v{version.versionNumber} <Chip tone="info">予約</Chip></p><p className={styles.railNote}>{version.effectiveFrom ? `${formatPhotoReceivedAt(version.effectiveFrom)}から` : '—'}</p><p className={styles.railNote}>{policyContent(version)}</p></div>) : <p className={styles.railNote}>予約中の版はありません</p>}</section>
          {canEdit ? <form className={styles.railCard} onSubmit={(event) => { event.preventDefault(); void save() }}>
            <h3 className={styles.railTitle}>引き出し：新しい版を作る</h3><p className={styles.railRow}>保存しても、使い始めの日時までは今の版のままです。</p>
            <div className={styles.historyFields}><label className={styles.fieldLabel}>採用したら（マイル）<TextField aria-label="採用したら（マイル）" inputMode="numeric" value={points} onChange={(event) => setPoints(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} disabled={saving} /></label>
              <label className={styles.fieldLabel}>掲載されたら（さらに）<TextField aria-label="掲載されたら（さらに）" inputMode="numeric" value={publicationPoints} onChange={(event) => setPublicationPoints(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} disabled={saving} /></label></div>
            <p className={styles.railNote}>掲載時の追加報酬は、同じ写真に一度だけ付与します。</p>
            <label className={styles.fieldLabel}>ひとこと（なぜ変えるか）<TextField value={summary} maxLength={200} disabled={saving} onChange={(event) => setSummary(event.target.value)} /></label>
            <label className={styles.fieldLabel}>使い始め（日本時間・空ならすぐ）<TextField type="datetime-local" value={effective} disabled={saving} onChange={(event) => setEffective(event.target.value)} /></label>
            {saveError ? <p role="alert" className={styles.errorText}>{saveError}</p> : null}
            <div className={styles.historyActions}><Button variant="secondary" disabled={saving} onClick={() => { setPoints(''); setPublicationPoints('0'); setSummary(''); setEffective(''); setSaveError('') }}>キャンセル</Button><Button type="submit" variant="primary" busy={saving} disabled={saving}>{effective ? '版を予約する' : '新しい版を保存する'}</Button></div>
          </form> : null}
        </div>
      </>}
    </Dialog>
    <ConfirmDialog open={revertOpen} title={`v${selected?.versionNumber}に戻しますか？`} description="過去の版は変わりません。その中身で新しい版を作ります。付与済みのマイルは変わりません。" busy={saving} error={saveError} confirmLabel="この版に戻す" onConfirm={() => void revert()} onCancel={() => { if (!saving) setRevertOpen(false) }} />
  </>
}
