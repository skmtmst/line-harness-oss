'use client'

import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '@/lib/api'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
import { FeatureLinkCard } from '@/components/shared/side-cards'
import { Tabs } from '@/components/shared/tabs'

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

  if (state === 'loading') return <main className="mx-auto max-w-screen-2xl p-6"><ListState kind="loading" title="出している写真を読み込んでいます" /></main>
  if (state === 'forbidden') return <main className="mx-auto max-w-screen-2xl p-6"><ListState kind="forbidden" /></main>
  if (state === 'error') return <main className="mx-auto max-w-screen-2xl p-6"><ListState kind="error" title="出している写真を読み込めませんでした" onRetry={() => void load()} /></main>
  if (!data || data.items.length === 0) return <main className="mx-auto max-w-screen-2xl p-6"><Button onClick={onBack}>写真審査へ戻る</Button><ListState kind="empty" title="出している写真はありません" description="同意のある写真を掲載すると、使っている場所と表示回数がここに出ます。" /></main>

  const top = data.summary.topPhoto
  return <><main className="mx-auto max-w-[1660px] p-6" data-photo-view="publications">
    <div className="flex items-center justify-between gap-2 max-md:flex-col max-md:items-start">
      <div><p className="text-xs font-bold text-ink-faint">専用機能</p><h1 className="mt-1 text-2xl font-extrabold text-ink">写真審査</h1></div>
      <Button onClick={onBack}>見ていないものへ戻る</Button>
    </div>
    <Tabs items={[{ label: '出しているもの', current: true }, { label: '並び順を変える', disabled: true }]} />
    {notice && <div className="mt-4"><Notice tone={notice.includes('できません') || notice.includes('変更しました') ? 'error' : 'success'} message={notice} /></div>}
    <section className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card padding="default"><span className="block text-xs text-ink-faint">出している写真</span><strong className="my-1 block text-2xl text-ink">{data.summary.publishedCount}枚</strong><small className="block text-xs text-ink-faint">通した写真のうち</small></Card>
      <Card padding="default"><span className="block text-xs text-ink-faint">どこで使っているか</span><strong className="my-1 block text-2xl text-ink">{data.summary.placementCount}か所</strong><small className="block text-xs text-ink-faint">現在つながっている掲載先</small></Card>
      <Card padding="default"><span className="block text-xs text-ink-faint">いちばん見られた</span><strong className="my-1 block truncate text-2xl text-ink">{top ? text(top.pet_name) : '—（未取得）'}</strong><small className="block text-xs text-ink-faint">{top ? views(top.view_count) : '表示回数は未取得'}</small></Card>
      <Card padding="default"><span className="block text-xs text-ink-faint">ご本人の同意</span><strong className="my-1 block text-2xl text-ink">{data.summary.consentedCount}枚 すべて</strong><small className="block text-xs text-ink-faint">投稿時に同意をいただいています</small></Card>
    </section>
    <div className="mt-4"><NoteBar>出している写真は、投稿してくださった方の名前を写真ごとに伏せられます。ご本人の希望があれば、すべての掲載先から外せます。</NoteBar></div>
    <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {data.items.map((item) => {
          const placements = Array.isArray(item.placements) ? item.placements as Array<Record<string, unknown>> : []
          return <Card key={text(item.id)} layout="vertical" overflow="hidden">
            {text(item.image_url) ? <img className="h-36 w-full object-cover" src={text(item.image_url)} alt={`${text(item.pet_name)}の公開写真`} /> : <div className="grid h-36 w-full place-items-center bg-canvas-sunken text-xs font-bold text-ink-faint">公開用画像を作成中です</div>}
            <div className="p-2.5"><strong className="text-sm text-accent-deep">{views(item.view_count)}</strong><h2 className="mt-0.5 text-base font-extrabold text-ink">{text(item.pet_name) || 'ペット名未取得'}</h2><p className="mt-0.5 text-xs text-ink-faint">{text(item.owner_name) || '名前は伏せています'}</p>
              <div className="mt-1 text-xs text-ink-faint">{placements.length ? placements.map((placement) => <span className="block truncate" key={text(placement.id)}>{text(placement.placement_label)}／{views(placement.view_count)}</span>) : <span>どこにも出していません</span>}</div>
              <div className="mt-2 flex items-center gap-2"><Button data-qa-open="J3Wxl8-placements" onClick={() => openPlacements(item)}>使う場所</Button><Button disabled={busyId === item.id} onClick={() => void withdraw(item)}>{busyId === item.id ? '外しています...' : '外す'}</Button></div>
            </div>
          </Card>
        })}
      </section>
      <aside className="space-y-3">
        <Card padding="default"><h2 className="text-sm font-extrabold text-ink">出すときの決めごと</h2><p className="mt-2 text-xs text-ink-secondary">投稿のときに公開への同意をいただいた写真だけを出します。</p><p className="mt-2 text-xs text-ink-secondary">名前は写真ごとに伏せられます。</p><p className="mt-2 text-xs text-ink-secondary">外すと、登録したすべての掲載先から外れ、審査と同意の履歴は残ります。</p></Card>
        <FeatureLinkCard items={[{ label: 'リッチメニュー', note: '写真を使う場所' }, { label: 'NENコラム', note: '公開写真を紹介する' }, { label: '回答フォーム', note: '回答画面へ表示する' }, { label: '登録メディア', note: '公開用画像の置き場' }]} />
      </aside>
    </div>
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
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-extrabold text-ink">使う場所</legend>
      {PLACEMENT_CHOICES.map((choice) => <label className="flex items-center gap-2 rounded-control border border-hairline p-3 text-xs font-bold text-ink-secondary" key={choice.type}>
        <input
          type="checkbox"
          checked={selectedPlacements.includes(choice.type)}
          onChange={(event) => setSelectedPlacements((current) => event.target.checked
            ? [...current, choice.type]
            : current.filter((value) => value !== choice.type))}
        />
        <span>{choice.label}</span>
      </label>)}
      <p className="text-xs leading-relaxed text-ink-faint">何も選ばず保存すると、現在の掲載先だけを外します。写真の公開同意と審査履歴は残ります。</p>
    </fieldset>
  </Dialog>}
  </>
}
