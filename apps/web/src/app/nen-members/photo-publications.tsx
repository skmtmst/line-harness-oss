'use client'

import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import styles from './photo-review.module.css'

const text = (value: unknown) => String(value ?? '')
const views = (value: unknown) => value == null ? '—（未取得）' : `${Number(value).toLocaleString('ja-JP')}回`
const PLACEMENT_CHOICES = [
  { type: 'rich_menu', label: 'リッチメニュー' },
  { type: 'column', label: 'NENコラム' },
  { type: 'form', label: '回答フォーム' },
  { type: 'site', label: 'サイト' },
] as const

export function PhotoPublications({ accountId, onBack }: { accountId: string; onBack: () => void }) {
  const [data, setData] = useState<{
    summary: { publishedCount: number; placementCount: number; topPhoto: Record<string, unknown> | null; consentedCount: number }
    items: Array<Record<string, unknown>>
  } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [selectedPlacements, setSelectedPlacements] = useState<string[]>([])
  const load = useCallback(async () => {
    setState('loading')
    try {
      const response = await api.nenMembers.photoPublications(accountId)
      if (!response.success) throw new Error(response.error)
      if (Array.isArray(response.data)) {
        setData({ summary: { publishedCount: 0, placementCount: 0, topPhoto: null, consentedCount: 0 }, items: [] })
        setState('ready')
        return
      }
      setData(response.data)
      setState('ready')
    } catch (error) {
      setData(null)
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])
  useEffect(() => { void load() }, [load])

  const withdraw = async (publication: Record<string, unknown>) => {
    setBusyId(text(publication.id))
    setNotice('')
    try {
      await api.nenMembers.withdrawPhotoPublication(text(publication.id), {
        accountId, expectedVersion: Number(publication.version),
      }, crypto.randomUUID())
      setNotice('写真をすべての掲載先から外しました。審査と同意の履歴は残ります。')
      await load()
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409
        ? '別の人が先に掲載状態を変更しました。最新の状態を読み直してください。'
        : '写真を掲載先から外せませんでした。')
    } finally { setBusyId('') }
  }

  const openPlacements = (publication: Record<string, unknown>) => {
    const current = Array.isArray(publication.placements)
      ? publication.placements as Array<Record<string, unknown>> : []
    setEditing(publication)
    setSelectedPlacements(current.map((placement) => text(placement.placement_type)))
  }

  const savePlacements = async () => {
    if (!editing) return
    setBusyId(text(editing.id))
    try {
      await api.nenMembers.updatePhotoPublicationPlacements(text(editing.id), {
        accountId,
        expectedVersion: Number(editing.version),
        placements: PLACEMENT_CHOICES.filter((choice) => selectedPlacements.includes(choice.type)),
      }, crypto.randomUUID())
      setEditing(null)
      setNotice('写真を使う場所を更新しました。')
      await load()
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409
        ? '別の人が先に掲載先を変更しました。最新の状態を読み直してください。'
        : '写真を使う場所を保存できませんでした。')
      setEditing(null)
    } finally { setBusyId('') }
  }

  if (state === 'loading') return <main className={styles.workspace}><ListState kind="loading" title="出している写真を読み込んでいます" /></main>
  if (state === 'forbidden') return <main className={styles.workspace}><ListState kind="forbidden" /></main>
  if (state === 'error') return <main className={styles.workspace}><ListState kind="error" title="出している写真を読み込めませんでした" onRetry={() => void load()} /></main>
  if (!data || data.items.length === 0) return <main className={styles.workspace}><Button onClick={onBack}>写真審査へ戻る</Button><ListState kind="empty" title="出している写真はありません" description="同意のある写真を掲載すると、使っている場所と表示回数がここに出ます。" /></main>

  const top = data.summary.topPhoto
  return <><main className={styles.workspace} data-photo-view="publications">
    <div className={styles.detailTop}>
      <div><p className={styles.eyebrow}>専用機能</p><h1 className={styles.detailTitle}>写真審査</h1></div>
      <Button onClick={onBack}>見ていないものへ戻る</Button>
    </div>
    <div className={styles.publicationTabs}><strong>出しているもの</strong><span>並び順を変える</span></div>
    {notice && <div className={styles.notice}>{notice}</div>}
    <section className={styles.summaryGrid}>
      <div><span>出している写真</span><strong>{data.summary.publishedCount}枚</strong><small>通した写真のうち</small></div>
      <div><span>どこで使っているか</span><strong>{data.summary.placementCount}か所</strong><small>現在つながっている掲載先</small></div>
      <div><span>いちばん見られた</span><strong>{top ? text(top.pet_name) : '—（未取得）'}</strong><small>{top ? views(top.view_count) : '表示回数は未取得'}</small></div>
      <div><span>ご本人の同意</span><strong>{data.summary.consentedCount}枚 すべて</strong><small>投稿時に同意をいただいています</small></div>
    </section>
    <p className={styles.publicationInfo}>出している写真は、投稿してくださった方の名前を写真ごとに伏せられます。ご本人の希望があれば、すべての掲載先から外せます。</p>
    <section className={styles.publicationGrid}>
      {data.items.map((item) => {
        const placements = Array.isArray(item.placements) ? item.placements as Array<Record<string, unknown>> : []
        return <article key={text(item.id)} className={styles.publicationCard}>
          {text(item.image_url) ? <img src={text(item.image_url)} alt={`${text(item.pet_name)}の公開写真`} /> : <div className={styles.publicImageMissing}>公開用画像を作成中です</div>}
          <div><strong className={styles.viewCount}>{views(item.view_count)}</strong><h2>{text(item.pet_name) || 'ペット名未取得'}</h2><p>{text(item.owner_name) || '名前は伏せています'}</p>
            <div className={styles.placementList}>{placements.length ? placements.map((placement) => <span key={text(placement.id)}>{text(placement.placement_label)}／{views(placement.view_count)}</span>) : <span>どこにも出していません</span>}</div>
            <div className={styles.cardActions}><Button data-qa-open="J3Wxl8-placements" onClick={() => openPlacements(item)}>使う場所</Button><Button disabled={busyId === item.id} onClick={() => void withdraw(item)}>{busyId === item.id ? '外しています...' : '外す'}</Button></div>
          </div>
        </article>
      })}
    </section>
    <section className={styles.policyCard}><h2>出すときの決めごと</h2><p>投稿のときに公開への同意をいただいた写真だけを出します。</p><p>名前は写真ごとに伏せられます。</p><p>外すと、登録したすべての掲載先から外れ、審査と同意の履歴は残ります。</p></section>
  </main>
  {editing && <Dialog
    open
    title={`${text(editing.pet_name) || 'この写真'}を使う場所`}
    description="選んだ場所へ公開用画像を出します。原本は公開しません。"
    confirmLabel="使う場所を保存"
    cancelLabel="戻る"
    busy={busyId === editing.id}
    onCancel={() => setEditing(null)}
    onConfirm={() => void savePlacements()}
  >
    <fieldset className={styles.placementChoices}>
      <legend>使う場所</legend>
      {PLACEMENT_CHOICES.map((choice) => <label key={choice.type}>
        <input
          type="checkbox"
          checked={selectedPlacements.includes(choice.type)}
          onChange={(event) => setSelectedPlacements((current) => event.target.checked
            ? [...current, choice.type]
            : current.filter((value) => value !== choice.type))}
        />
        <span>{choice.label}</span>
      </label>)}
      <p>何も選ばず保存すると、現在の掲載先だけを外します。写真の公開同意と審査履歴は残ります。</p>
    </fieldset>
  </Dialog>}
  </>
}
