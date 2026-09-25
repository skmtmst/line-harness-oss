'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, webinarApi, type Webinar, type WebinarInput, type WebinarScheduleRule } from '@/lib/api'
import type { MediaItem } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import StickyBar from '@/components/shared/sticky-bar'
import DateTimeField, { TimeField } from '@/components/shared/date-time-field'
import { CareCard } from '@/components/shared/side-cards'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { RequiredBadge } from '@/components/shared/form-controls'
import { webinarErrorText } from './webinar-error-text'

const DAYS = ['日', '月', '火', '水', '木', '金', '土']

const inputClass =
  'w-full border border-hairline rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15'
const labelClass = 'block text-sm font-medium text-ink-secondary mb-1.5'

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0)
}

function minutesToTime(value: number): string {
  const normalized = ((value % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

function inferDailySchedule(rules: WebinarScheduleRule[]): { start: string; end: string; interval: number } {
  const times = rules
    .filter((rule) => rule.type === 'daily' && rule.time)
    .map((rule) => rule.time as string)
    .sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
  const intervals = times.slice(1).map((time, index) => timeToMinutes(time) - timeToMinutes(times[index]))
  const interval = intervals.length > 0 && intervals.every((value) => value === intervals[0]) ? intervals[0] : 30
  return { start: times[0] ?? '00:00', end: times[times.length - 1] ?? '23:30', interval: interval > 0 ? interval : 30 }
}

export interface WebinarFormProps {
  initial?: Webinar
  /*
    編集画面の段（step）の中に置くとき、下の固定バーは親の1本にまとめる。
    `hideBar` で内側の保存バーを出さず、`registerSave` / `onDirtyChange` で
    親の固定バーから保存・未保存表示を操作できるようにする。
  */
  hideBar?: boolean
  /** 編集で保存できたとき、一覧へ戻さず新しい中身を呼び出し側へ返す。 */
  onSaved?: (webinar: Webinar) => void
  /** 保存していない変更があるかを親へ伝える。 */
  onDirtyChange?: (dirty: boolean) => void
  /** 親へ保存操作を登録する。戻り値が true のときだけ保存が完了している。 */
  registerSave?: (save: (() => Promise<boolean>) | null) => void
}

export default function WebinarForm({ initial, hideBar = false, onSaved, onDirtyChange, registerSave }: WebinarFormProps) {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [status, setStatus] = useState<Webinar['status']>(initial?.status ?? 'draft')
  const [durationMinutes, setDurationMinutes] = useState(
    initial ? Math.round(initial.durationSeconds / 60) : 120,
  )
  const [rules, setRules] = useState<WebinarScheduleRule[]>(initial?.schedule ?? [])
  const initialDaily = inferDailySchedule(initial?.schedule ?? [])
  const [bulkStart, setBulkStart] = useState(initialDaily.start)
  const [bulkEnd, setBulkEnd] = useState(initialDaily.end)
  const [bulkInterval, setBulkInterval] = useState(initialDaily.interval)
  /*
    動画はメディアライブラリの動画から選ぶ。保存値はサーバーが選択から
    生成するので、ここで R2 のパスを手入力させない。
    EXTERNAL_VIDEO は「ライブラリ外のprefixが既に設定されている」ときだけ
    選べる維持用の値で、選び直さない限り現在の設定を送らず残す。
  */
  const EXTERNAL_VIDEO = '__external__'
  const [videoChoice, setVideoChoice] = useState<string>(
    initial?.videoMediaId ?? (initial?.videoPrefix ? EXTERNAL_VIDEO : ''),
  )
  const videoAccountId = initial?.accountId ?? selectedAccountId
  const [videoMedia, setVideoMedia] = useState<MediaItem[] | null>(null)
  const [videoMediaError, setVideoMediaError] = useState(false)
  const [mediaLoadKey, setMediaLoadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)

  /* 動画の選択肢は同一アカウントの動画メディアだけ。選べるまで保存を待たせる
     必要はないが、候補が読めないときは選択を空で誤保存させない。 */
  useEffect(() => {
    if (!videoAccountId) return
    let cancelled = false
    setVideoMedia(null)
    setVideoMediaError(false)
    api.media
      .list(videoAccountId, { kind: 'video', limit: 100 })
      .then((res) => {
        if (cancelled) return
        if (res.success) setVideoMedia(res.data.items)
        else setVideoMediaError(true)
      })
      .catch(() => { if (!cancelled) setVideoMediaError(true) })
    return () => { cancelled = true }
  }, [videoAccountId, mediaLoadKey])

  /* 公開判定に効くのは「今選ばれているもの」。外部prefixの維持を選んだ
     ときだけ、既存の保存値をそのまま動画ありとして数える。 */
  const videoReady = videoChoice === EXTERNAL_VIDEO
    ? Boolean(initial?.videoPrefix?.trim())
    : Boolean(videoChoice)

  /*
    「最後に読めた・保存できた内容」を未保存判定の正本にする。
    保存できたらこの基準も一緒に進めるので、保存後に
    「未保存」の印が残ったり、段を往復して入力が消えたりしない。
  */
  const [baseline, setBaseline] = useState(() => ({
    title: initial?.title ?? '',
    slug: initial?.slug ?? '',
    status: (initial?.status ?? 'draft') as Webinar['status'],
    durationMinutes: initial ? Math.round(initial.durationSeconds / 60) : 120,
    videoChoice: initial?.videoMediaId ?? (initial?.videoPrefix ? EXTERNAL_VIDEO : ''),
    rules: (initial?.schedule ?? []) as WebinarScheduleRule[],
  }))

  /** 下書きから公開へ変えるときだけ、確認を挟む。 */
  const isPublishing = status === 'active' && baseline.status !== 'active'

  /*
    未保存の変更があるか。**段を行き来しても消えない画面にするため、**
    親の固定バーが「未保存」を出す材料にする。
  */
  const dirty =
    title !== baseline.title ||
    slug !== baseline.slug ||
    status !== baseline.status ||
    durationMinutes !== baseline.durationMinutes ||
    videoChoice !== baseline.videoChoice ||
    JSON.stringify(rules) !== JSON.stringify(baseline.rules)

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  /* 画面から外れるときは未保存の印を残さない。 */
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  /**
   * 公開してよいか。**足りないまま公開すると、友だちの画面で気づくことになる。**
   * 動画が無ければ視聴できず、枠が無ければ「次の回」が出ない。
   */
  const publicationProblem = (): string => {
    if (!videoReady) return '公開する前に動画を設定してください。動画が無いままでは友だちが視聴できません。'
    if (rules.length === 0) return '公開する前に配信枠を1件以上設定してください。'
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1) return '動画の長さを1分以上で設定してください。'
    return ''
  }

  /**
   * 保存してよい状態か整えてから保存する。戻り値は「保存が完了したか」。
   * 公開の確認を開いたときは false ——保存はまだ終わっていない。
   */
  const requestSave = async (): Promise<boolean> => {
    if (!isPublishing) {
      return save()
    }
    const problem = publicationProblem()
    if (problem) {
      setError(problem)
      return false
    }
    setError(null)
    setPublishConfirmOpen(true)
    return false
  }

  /*
    親の固定バーから呼べるよう、いちばん新しい保存操作を登録する。
    確認を挟む公開の流れも含めて `requestSave` を渡す。
  */
  const requestSaveRef = useRef(requestSave)
  useEffect(() => {
    requestSaveRef.current = requestSave
  })
  useEffect(() => {
    if (!registerSave) return
    registerSave(() => requestSaveRef.current())
    return () => registerSave(null)
  }, [registerSave])

  const updateRule = (i: number, patch: Partial<WebinarScheduleRule>) =>
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const applyDailySchedule = () => {
    const start = timeToMinutes(bulkStart)
    const end = timeToMinutes(bulkEnd)
    if (end < start || bulkInterval <= 0) {
      setError('一括設定の開始・終了時間を確認してください')
      return
    }
    const generated: WebinarScheduleRule[] = []
    for (let minute = start; minute <= end; minute += bulkInterval) {
      generated.push({ type: 'daily', time: minutesToTime(minute) })
    }
    setRules((prev) => [...prev.filter((rule) => rule.type !== 'daily'), ...generated])
    setError(null)
  }

  const dailyRules = rules.filter((rule) => rule.type === 'daily' && rule.time)
  const dailyOverview = inferDailySchedule(rules)
  const nonDailyCount = rules.length - dailyRules.length

  /** 保存が完了したら true。失敗したら入力を残したまま false を返す。 */
  const save = async (): Promise<boolean> => {
    if (!initial && !selectedAccountId) {
      setError('上のバーでLINE公式アカウントを選んでください')
      return false
    }
    setSaving(true)
    setError(null)
    const input: WebinarInput = {
      title,
      slug,
      status,
      durationSeconds: durationMinutes * 60,
      schedule: rules,
      ...(!initial ? { accountId: selectedAccountId } : {}),
      /* 動画はメディア選択のIDだけを送り、保存値はサーバーが生成する。
         外部prefixの維持を選んだときは何も送らず既存値を残す。 */
      ...(videoChoice === EXTERNAL_VIDEO ? {} : { videoMediaId: videoChoice || null }),
    }
    try {
      if (initial) {
        const updated = await webinarApi.update(initial.id, input)
        /* 未保存判定の正本を送った内容へ進める。画面を畳まなくても印が消える。 */
        setBaseline({ title, slug, status, durationMinutes, videoChoice, rules })
        /* 公開したときは完了の面へ。**何が公開されたのかを最後に読ませる。** */
        if (isPublishing) {
          router.push(`/webinars/published?id=${updated.data.id}`)
          return true
        }
        /* 編集画面の段の中では、一覧へ戻さず新しい中身を親へ返す。 */
        if (onSaved) {
          onSaved(updated.data)
          return true
        }
        router.push('/webinars')
        return true
      }
      const created = await webinarApi.create(input)
      /* 作ってすぐ公開したときも、完了の面へ。 */
      router.push(isPublishing ? `/webinars/published?id=${created.data.id}` : `/webinars/edit?id=${created.data.id}`)
      return true
    } catch (err) {
      setError(webinarErrorText(err, '保存できませんでした。入力を見直してください。'))
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="p-3 bg-danger-bg border border-danger/20 rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/* ★V7: 基本の段も共通の枠の幅で「本体＋右の案内」の2列にする。右の文は画面内の既存の文だけを使う。 */}
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
      <section className="space-y-4 rounded-2xl border border-hairline bg-canvas p-5 shadow-sm sm:p-6">
        <div><h2 className="font-bold text-ink">基本情報</h2><p className="mt-1 text-xs text-ink-faint">普段変更する項目だけを表示しています</p></div>
        <div>
          <label className={labelClass}>
            タイトル
            <RequiredBadge />
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：然-NEN- はじめての定期便セミナー"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>公開状態</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Webinar['status'])}
            className={`${inputClass} w-auto`}
          >
            <option value="draft">下書き</option>
            <option value="active">公開中</option>
            <option value="archived">アーカイブ</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>動画の長さ（分）</label>
          <input
            type="number"
            value={durationMinutes}
            min={1}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className={`${inputClass} w-32`}
          />
        </div>
        <details className="group rounded-xl border border-hairline bg-canvas-sunken/60">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-ink-secondary">
            URL・動画ファイルの詳細設定
            <span className="text-xs text-ink-faint group-open:rotate-180">▾</span>
          </summary>
          <div className="space-y-4 border-t border-hairline p-4">
            <div>
              <label className={labelClass}>slug（URL 用・半角英数とハイフン）</label>
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-seminar" className={`${inputClass} font-mono text-xs`} />
            </div>
            <div>
              <label className={labelClass}>配信動画（メディアライブラリの動画から選択）</label>
              {!videoAccountId ? (
                <p className="text-xs text-ink-faint">LINE公式アカウントに割り当てると動画を選べます。</p>
              ) : videoMediaError ? (
                <p className="text-xs text-danger" role="alert">
                  動画の候補を読み込めませんでした。
                  <button type="button" onClick={() => setMediaLoadKey((key) => key + 1)} className="ml-2 font-medium underline">もう一度読み込む</button>
                </p>
              ) : (
                <select
                  aria-label="配信動画"
                  value={videoChoice}
                  onChange={(e) => setVideoChoice(e.target.value)}
                  disabled={videoMedia === null}
                  className={inputClass}
                >
                  <option value="">設定しない</option>
                  {videoChoice === EXTERNAL_VIDEO && (
                    <option value={EXTERNAL_VIDEO}>現在の設定を維持（ライブラリ外の動画）</option>
                  )}
                  {(videoMedia ?? []).map((item) => (
                    <option key={item.id} value={item.id}>{item.filename}</option>
                  ))}
                  {videoMedia && videoChoice && videoChoice !== EXTERNAL_VIDEO &&
                    !videoMedia.some((item) => item.id === videoChoice) && (
                    <option value={videoChoice}>現在の動画（ライブラリで見つかりません）</option>
                  )}
                </select>
              )}
              {videoChoice === EXTERNAL_VIDEO && initial?.videoPrefix && (
                <p className="mt-1 text-micro text-ink-faint">現在の設定: {initial.videoPrefix}</p>
              )}
            </div>
          </div>
        </details>
      </section>

      <section className="overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-sm">
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><h2 className="font-bold text-ink">配信スケジュール</h2><p className="mt-1 text-xs text-ink-faint">日本時間。参加画面には直近の候補だけが表示されます。</p></div>
            <span className="w-fit rounded-full bg-info-bg px-3 py-1 text-xs font-semibold text-info">{rules.length}枠</span>
          </div>
          {rules.length === 0 && (
            /* 枠が無いと、公開しても友だちの画面に「次の回」が出ない。
               作ったのに見られない状態になるので、その場で断る。 */
            <p className="text-warning bg-warning-bg rounded-card mt-3 p-3 text-xs">
              配信枠が未設定です。このままでは友だちが視聴できません。
            </p>
          )}
          {dailyRules.length > 0 ? (
            <div className="mt-4 flex flex-col gap-1 rounded-xl border border-info/25 bg-info-bg p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-bold text-ink">毎日 {dailyOverview.start}〜{dailyOverview.end}</div>
              <div className="text-xs font-medium text-ink-secondary">{dailyOverview.interval}分間隔 · {dailyRules.length}枠{nonDailyCount > 0 ? ` ＋ 個別${nonDailyCount}枠` : ''}</div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">毎日の配信枠は未設定です</div>
          )}
        </div>

        <details className="group border-t border-hairline">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold text-ink-secondary hover:bg-canvas-sunken sm:px-6">
            枠を一括設定・個別編集する
            <span className="text-xs text-ink-faint group-open:rotate-180">▾</span>
          </summary>
          <div className="space-y-4 border-t border-hairline bg-canvas-sunken/50 p-4 sm:p-6">
            <div className="rounded-xl border border-hairline bg-canvas p-4">
              <div className="mb-3 text-xs font-bold text-ink-secondary">毎日の枠をまとめて作成</div>
              <div className="flex flex-wrap items-end gap-3">
                <span className="text-xs text-ink-faint">開始<TimeField value={bulkStart} onChange={setBulkStart} aria-label="まとめて作る枠の開始" className="mt-1" /></span>
                <span className="text-xs text-ink-faint">終了<TimeField value={bulkEnd} onChange={setBulkEnd} aria-label="まとめて作る枠の終了" className="mt-1" /></span>
                <label className="text-xs text-ink-faint">間隔<select value={bulkInterval} onChange={(e) => setBulkInterval(Number(e.target.value))} className="mt-1 block rounded-lg border border-hairline px-2 py-2 text-sm"><option value={30}>30分</option><option value={60}>60分</option><option value={120}>120分</option></select></label>
                <button type="button" onClick={applyDailySchedule} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:brightness-92">毎日の枠を置き換える</button>
              </div>
              <p className="mt-2 text-[11px] text-ink-faint">下の保存ボタンを押すまでは本番へ反映されません。</p>
            </div>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
        {rules.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline p-2 text-sm">
            <select
              value={r.type}
              onChange={(e) => {
                const type = e.target.value as WebinarScheduleRule['type']
                updateRule(
                  i,
                  type === 'once'
                    ? { type, time: undefined, days: undefined, at: '' }
                    : { type, time: r.time ?? '20:00', days: type === 'weekly' ? [] : undefined, at: undefined },
                )
              }}
              className="rounded-lg border border-hairline px-2 py-1"
            >
              <option value="daily">毎日</option>
              <option value="weekly">毎週</option>
              <option value="once">単発</option>
            </select>
            {r.type === 'weekly' &&
              DAYS.map((d, di) => (
                <label key={di} className="flex items-center gap-0.5">
                  <input
                    type="checkbox"
                    checked={r.days?.includes(di) ?? false}
                    onChange={(e) =>
                      updateRule(i, {
                        days: e.target.checked
                          ? [...(r.days ?? []), di]
                          : (r.days ?? []).filter((x) => x !== di),
                      })
                    }
                  />
                  {d}
                </label>
              ))}
            {r.type === 'once' ? (
              <DateTimeField
                value={(r.at ?? '').slice(0, 16)}
                onChange={(v) => updateRule(i, { at: `${v}:00+09:00` })}
                aria-label="開催日時"
              />
            ) : (
              <TimeField
                value={r.time ?? '20:00'}
                onChange={(v) => updateRule(i, { time: v })}
                aria-label="開催時刻"
              />
            )}
            <button
              onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))}
              className="ml-auto text-danger hover:underline"
            >
              削除
            </button>
          </div>
        ))}
            </div>
        <button
          onClick={() => setRules((prev) => [...prev, { type: 'daily', time: '20:00' }])}
          className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-canvas-sunken"
        >
          ＋ ルール追加
        </button>
          </div>
        </details>
      </section>
        </div>
        <aside className="space-y-4" aria-label="基本設定の案内">
          <CareCard
            items={[
              { head: '枠が無いまま公開すると、友だちの画面に「次の回」が出ません', note: '作ったのに見られない状態になるので、配信枠を先に作ります。' },
              { head: '枠を変えても、下の保存を押すまでは本番へ反映されません' },
              { head: '公開すると、友だちが申込・視聴できるようになります', note: '公開ページのURLもすぐに開けるようになります。' },
            ]}
          />
        </aside>
      </div>

      {/* 段画面の中では親の固定バーが保存を引き受ける。保存バーは1つにする。 */}
      {hideBar ? null : (
      <StickyBar
        status="変更内容を確認して本番へ反映します"
        actions={<button onClick={() => void requestSave()} disabled={saving} className="rounded-xl bg-action px-6 py-2.5 text-sm font-bold text-on-action shadow-sm disabled:opacity-50">{saving ? '保存中...' : isPublishing ? '公開する' : '変更を保存'}</button>}
      />
      )}

      {/*
        公開の確認（設計 `D6yO7e` 10-1-G）。**押した瞬間に友だちへ出さない。**
        公開すると申込と視聴が始まるので、何が起きるかを先に読ませる。
        下書き保存には出さない——誰にも届かないので、段を増やすと手間が増える
        だけになる。
      */}
      <ConfirmDialog
        open={publishConfirmOpen}
        title={`「${title || '無題のウェビナー'}」を公開しますか？`}
        description="公開すると、友だちが申込・視聴できるようになります。公開ページのURLもすぐに開けるようになります。"
        confirmLabel="この内容で公開する"
        busy={saving}
        onCancel={() => {
          if (saving) return
          setPublishConfirmOpen(false)
        }}
        onConfirm={() => {
          setPublishConfirmOpen(false)
          void save()
        }}
      >
        <dl className="text-ink-secondary space-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="text-ink-faint shrink-0">公開ページ</dt>
            <dd className="min-w-0">/webinar/{slug || '未設定'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-faint shrink-0">配信枠</dt>
            <dd className="min-w-0">{rules.length}件</dd>
          </div>
        </dl>
      </ConfirmDialog>
    </div>
  )
}
