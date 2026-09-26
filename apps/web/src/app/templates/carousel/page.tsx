'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import type { Folder } from '@line-crm/shared'
import { Field, inputClass } from '@/components/shared/create-page'
import Notice from '@/components/shared/notice'
import SelectField from '@/components/shared/select-field'
import InlineActionList, { useActionOptions } from '@/components/auto-replies/inline-action-list'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  readInlineActions,
  toActionPayload,
  type InlineAction,
} from '@/components/auto-replies/draft-fields'

/**
 * カルーセルの編集。
 *
 * JSONを手で書かずに済むようにする。制限（LINEの決まり）を入力の
 * そばに出して、保存する前に気づけるようにしている。
 */

const MAX_COLUMNS = 10
const MAX_ACTIONS = 3
const TITLE_MAX = 40
const TEXT_MAX_WITH_IMAGE = 60
const TEXT_MAX_WITHOUT_IMAGE = 120

/** 選択肢1つぶん。 */
interface Choice {
  label: string
  /** 'uri'（URLを開く）か 'action'（押されたときに何かする）。 */
  kind: 'uri' | 'action'
  uri: string
  /** kind='action' のときに実行する並び。 */
  actions: InlineAction[]
}

interface Panel {
  thumbnailImageUrl: string
  title: string
  text: string
  actions: Choice[]
}

function emptyChoice(): Choice {
  return { label: '', kind: 'uri', uri: '', actions: [] }
}

function emptyPanel(): Panel {
  return { thumbnailImageUrl: '', title: '', text: '', actions: [emptyChoice()] }
}

function visualPanels(): Panel[] {
  return Array.from({ length: 5 }, (_, index) => ({
    thumbnailImageUrl: '',
    title: index === 1 ? '夏の定番セット（送料込み）' : `パネル ${index + 1}`,
    text: index === 1 ? 'この夏いちばん出ているセットです。8月末まで送料無料。' : '毎月おなじものが届きます。いつでも止められます。',
    actions: [
      { label: index === 1 ? 'このセットを見る' : '詳しく見る', kind: 'action' as const, uri: '', actions: [] },
      { label: 'あとで見る', kind: 'action' as const, uri: '', actions: [] },
    ],
  }))
}

/*
 * 選択肢の中身を組み立てる。
 *
 * 「押されたときに何かする」を選んだ選択肢は postback になる。data には
 * どのテンプレートのどの選択肢かを入れる。**テンプレートの id は、新規作成の
 * ときまだ決まっていない**ので、いったん空で作り、id が返ってから埋めて
 * 保存し直す（saveCarousel の2段階目）。
 */
function buildCarouselContent(panels: Panel[], templateId: string): string {
  return JSON.stringify(
    panels.map((p, ci) => ({
      ...(p.thumbnailImageUrl.trim() ? { thumbnailImageUrl: p.thumbnailImageUrl.trim() } : {}),
      ...(p.title.trim() ? { title: p.title.trim() } : {}),
      text: p.text.trim(),
      actions: p.actions
        .filter((a) => a.label.trim())
        .map((a, ai) =>
          a.kind === 'action'
            ? {
                type: 'postback',
                label: a.label.trim(),
                data: `ctpl=${templateId}&c=${ci}&a=${ai}`,
              }
            : { type: 'uri', label: a.label.trim(), uri: a.uri.trim() },
        ),
    })),
  )
}

/** 選択肢ごとのアクションは、パネル番号 → 選択肢番号 の入れ子で持つ。 */
function buildCarouselActions(panels: Panel[]): Record<string, Record<string, unknown[]>> {
  const carouselActions: Record<string, Record<string, unknown[]>> = {}
  panels.forEach((p, ci) => {
    p.actions
      .filter((a) => a.label.trim())
      .forEach((a, ai) => {
        if (a.kind !== 'action' || a.actions.length === 0) return
        carouselActions[String(ci)] ??= {}
        carouselActions[String(ci)][String(ai)] = a.actions.map(toActionPayload)
      })
  })
  return carouselActions
}

interface CarouselSaveInput {
  /**
   * 保存先のテンプレート id。URL の `?id=`、またはこの画面での保存が
   * 「作成」まで済んで「postback 埋め直し」で止まったときの作成済み id。
   * 後者を渡せば、再試行は新規作成ではなく更新になる（重複を作らない）。
   */
  templateId: string | null
  /** 新規作成のときだけ使う。 */
  selectedAccountId: string | null
  name: string
  panels: Panel[]
  folderId: string | null
  tapLimitMode: 'none' | 'once'
  tapLimitText: string
}

type CarouselSaveResult =
  | { ok: true }
  | {
      ok: false
      error: string
      /**
       * N-149: 作成だけ済んで後段が失敗したとき、その id を返す。
       * 画面はこれを覚えて、再試行を「作成し直し」ではなく「更新」にする。
       */
      createdId?: string
    }

interface CarouselSaveOps {
  create: typeof api.templates.create
  update: typeof api.templates.update
}

/**
 * カルーセルを保存する。**失敗しても入力を捨てない、途中で止まっても
 * 同じ内容で再試行できる**ことが N-149 の要件。
 *
 * 新規は2段階。1段階目（作成）だけ済んで2段階目（postback の data に
 * id を埋めて保存し直し）が失敗したら、作成済みの id を `createdId` で
 * 返す。次の保存はそれを `templateId` へ入れて呼ばれるので、同じ
 * テンプレートへの更新としてやり直せ、二重に作られない。
 */
async function saveCarousel(
  input: CarouselSaveInput,
  ops: CarouselSaveOps = { create: api.templates.create, update: api.templates.update },
): Promise<CarouselSaveResult> {
  // サーバー側でも同じ制限を見る。何枚目の何が問題かを返してくれる。
  const carouselActions = buildCarouselActions(input.panels)
  const carouselOptions = {
    carouselActions: Object.keys(carouselActions).length > 0 ? carouselActions : null,
    carouselTapLimitMode: input.tapLimitMode,
    carouselTapLimitText: input.tapLimitText.trim() || null,
  }

  /*
   * 作成が済んでからの失敗は、再試行を更新へ切り替えられるよう id を持ち
   * 回る。通信エラー（例外）でも同じ扱いにしないと、再試行で複製される。
   */
  let createdId: string | undefined
  const fail = (error: string): CarouselSaveResult =>
    createdId ? { ok: false, error, createdId } : { ok: false, error }

  try {
    if (input.templateId) {
      // 更新、または「作成済みへのやり直し」。id が決まっているので
      // postback の data も最初から正しく入る。
      const res = await ops.update(input.templateId, {
        name: input.name.trim(),
        messageType: 'carousel',
        messageContent: buildCarouselContent(input.panels, input.templateId),
        folderId: input.folderId,
        ...carouselOptions,
      })
      return res.success ? { ok: true } : fail(res.error)
    }

    const created = await ops.create({
      accountId: input.selectedAccountId!,
      name: input.name.trim(),
      category: 'カルーセル',
      messageType: 'carousel',
      messageContent: buildCarouselContent(input.panels, ''),
      folderId: input.folderId,
      ...carouselOptions,
    })
    if (!created.success) return fail(created.error)
    createdId = created.data.id

    // id が決まったので、postback の data を埋め直す。
    // 「押されたときに何かする」選択肢が1つも無ければ、埋め直す必要はない。
    const hasPostback = input.panels.some((p) => p.actions.some((a) => a.kind === 'action'))
    if (hasPostback) {
      const fixed = await ops.update(createdId, {
        messageContent: buildCarouselContent(input.panels, createdId),
      })
      if (!fixed.success) return fail(fixed.error)
    }
    return { ok: true }
  } catch (e) {
    return fail(e instanceof Error ? e.message : '保存に失敗しました。通信を確かめて、もう一度お試しください。')
  }
}

function CarouselEditorInner() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const params = useSearchParams()
  const id = params.get('id')
  const visual = params.get('visual') === '1'
  usePageTitle(id ? 'カルーセルの編集' : 'カルーセルを作る')

  const [name, setName] = useState(visual ? '夏の定番5点' : '')
  const [panels, setPanels] = useState<Panel[]>(visual ? visualPanels() : [emptyPanel()])
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  /*
   * N-149: 「作成」だけ済んで後段が止まったときの作成済み id。これを持つ
   * 間は、再試行は新規作成ではなくそのテンプレートへの更新になる。
   */
  const [createdId, setCreatedId] = useState<string | null>(null)
  /*
   * N-149: 保存が通信段まで行って失敗したか。true のときだけ、原因の
   * そばに「もう一度保存する」を出す。入力の不備（名前が空など）では
   * 出さない——直すのは操作ではなく中身だから。
   */
  const [saveFailed, setSaveFailed] = useState(false)
  /*
   * 二重クリック対策は state では間に合わない。`setSaving(true)` が描画へ
   * 届く前に2回目の押下が来るので、同期で立つ旗を別に持つ。
   */
  const savingRef = useRef(false)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  // 編集時はテンプレートが属するアカウント。選択中と食い違うことがある（N-147）。
  const [templateAccountId, setTemplateAccountId] = useState<string | null>(null)
  const [tapLimitMode, setTapLimitMode] = useState<'none' | 'once'>('none')
  const [tapLimitText, setTapLimitText] = useState('')
  /*
   * N-144: カルーセルの作成・保存APIは owner/admin だけ。staff が
   * シナリオ画面の選択肢から辿って来ても、フォームは出さない。
   */
  const [canMutateTemplates] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())
  const actionOptions = useActionOptions()

  // 置き場は「編集しているテンプレートのアカウント」のものだけを出す。
  // 新規作成では選択中のアカウント。読み替えるまで前のアカウントの帯は残さない。
  const folderAccountId = id ? templateAccountId : selectedAccountId
  useEffect(() => {
    setFolders([])
    if (!folderAccountId) return
    let cancelled = false
    void api.folders.list('template', folderAccountId).then((res) => {
      if (!cancelled && res.success) setFolders(res.data)
    })
    return () => { cancelled = true }
  }, [folderAccountId])

  const markLoadFailed = () => {
    setLoadFailed(true)
    setError('読み込めませんでした。開き直してください。')
  }

  useEffect(() => {
    if (!id) return
    void api.templates
      .get(id)
      .then((res) => {
        if (!res.success) {
          markLoadFailed()
          return
        }
        setName(res.data.name)
        setTemplateAccountId(res.data.accountId ?? null)
        setFolderId(res.data.folderId ?? null)
        setTapLimitMode(res.data.carouselTapLimitMode === 'once' ? 'once' : 'none')
        setTapLimitText(res.data.carouselTapLimitText ?? '')
        const storedActions = (res.data.carouselActions ?? null) as Record<
          string,
          Record<string, unknown[]>
        > | null
        try {
          const parsed = JSON.parse(res.data.messageContent) as unknown
          const columns = Array.isArray(parsed)
            ? parsed
            : ((parsed as { columns?: unknown })?.columns ?? [])
          if (Array.isArray(columns) && columns.length > 0) {
            setPanels(
              columns.map((c, i) => {
                const col = c as Partial<Panel>
                return {
                  thumbnailImageUrl: col.thumbnailImageUrl ?? '',
                  title: col.title ?? '',
                  text: col.text ?? '',
                  actions:
                    Array.isArray(col.actions) && col.actions.length > 0
                      ? (col.actions as unknown as Array<Record<string, unknown>>).map((a, ai) => {
                          const isUri = a.type === 'uri' || typeof a.uri === 'string'
                          return {
                            label: (a.label as string) ?? '',
                            kind: isUri ? ('uri' as const) : ('action' as const),
                            uri: (a.uri as string) ?? '',
                            actions: readInlineActions(
                              (storedActions?.[String(i)]?.[String(ai)] as unknown[]) ?? null,
                            ),
                          }
                        })
                      : [emptyChoice()],
                }
              }),
            )
          }
        } catch {
          // 読めない中身は空のまま。上書きするかどうかは人が決める。
          setError('いまの中身を読み取れませんでした。保存すると上書きされます。')
        }
      })
      .catch(markLoadFailed)
      .finally(() => setLoading(false))
  }, [id])

  const update = (index: number, patch: Partial<Panel>) =>
    setPanels((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))

  /**
   * パネルを1つ隣と入れ替える。
   *
   * カルーセルは横に並ぶので「上下」ではなく「左右」。端では何もしない
   * （ボタン側でも押せなくしているが、キーボードから呼ばれても配列の外に
   * 出ないよう、ここでも見る）。
   */
  const move = (index: number, direction: -1 | 1) =>
    setPanels((prev) => {
      const to = index + direction
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })

  const anyImage = panels.some((p) => p.thumbnailImageUrl.trim())
  const textMax = anyImage ? TEXT_MAX_WITH_IMAGE : TEXT_MAX_WITHOUT_IMAGE

  const save = async () => {
    /*
     * N-149: 保存中の再入をここで断る。ボタンの disabled は描画を待つので、
     * 連打・Enter 連打・二重送信をこの旗だけで止める。
     */
    if (savingRef.current) return
    if (loadFailed) {
      setError('読み込めませんでした。開き直してください。')
      return
    }
    if (!id && !createdId && !selectedAccountId) {
      setError('上のバーでLINE公式アカウントを選んでください')
      return
    }
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }

    savingRef.current = true
    setSaving(true)
    setError('')
    setSaveFailed(false)
    try {
      /*
       * templateId には URL の id を優先し、なければ「作成済みで後段が
       * 止まった」id を渡す。作成まで済んだ下書きを作り直さない。
       */
      const res = await saveCarousel({
        templateId: id ?? createdId,
        selectedAccountId,
        name,
        panels,
        folderId,
        tapLimitMode,
        tapLimitText,
      })
      if (!res.ok) {
        if (res.createdId) setCreatedId(res.createdId)
        setError(res.error)
        // 入力は state に残ったまま。原因と再試行の口を一緒に出す。
        setSaveFailed(true)
        return
      }
      // 成功したときだけ完了（一覧へ戻る）。失敗では画面を動かさない。
      router.push('/templates')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (!canMutateTemplates) {
    return (
      <div>
        <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
          <Link href="/templates" className="hover:underline">
            テンプレート
          </Link>
          <span className="mx-1.5">/</span>
          <span>カルーセル</span>
        </nav>
        <div role="alert" className="bg-canvas rounded-card border-hairline border p-8 text-sm">
          <p className="font-bold text-ink">カルーセルの作成・変更はオーナーと管理者だけができます</p>
          <Link href="/templates" className="text-action hover:underline mt-3 inline-block text-sm">一覧へ戻る</Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/templates" className="hover:underline">
          テンプレート
        </Link>
        <span className="mx-1.5">/</span>
        <span>{name || 'カルーセル'}</span>
      </nav>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row">
          {/*
            ★V7: 本体＋右のプレビューの2列を、通常の横並びで組む。
            以前は右列を絶対配置にしていた。1920px で本体が左に寄り、
            右が大きく空いて見えた。読み上げ順は変えない（案内が先）。
          */}
          <aside className="hidden w-full shrink-0 xl:order-2 xl:block xl:w-96">
            <section className="rounded-card bg-line-preview p-4 text-on-accent">
              <h2 className="text-center text-sm font-bold">LINEプレビュー</h2>
              <p className="mx-auto mt-2 w-fit rounded-pill bg-line-preview-label px-3 py-1 text-xs">カルーセルの見え方（横にスクロールします）</p>
              <div className="rounded-card mt-4 overflow-hidden bg-canvas text-ink">
                <div className="bg-canvas-sunken h-36" />
                <div className="p-4">
                  <p className="font-bold">{panels[1]?.title || panels[0]?.title || '（タイトル）'}</p>
                  <p className="mt-2 text-sm leading-relaxed">{panels[1]?.text || panels[0]?.text}</p>
                  {(panels[1]?.actions || panels[0]?.actions || []).map((action, index) => <p key={index} className="border-hairline mt-2 rounded-control border p-2 text-center text-sm text-accent-deep">{action.label}</p>)}
                </div>
              </div>
              {/*
                NEXT-24: テンプレートのテスト送信口はまだ無い。押せる見た目の
                まま置くと「送れた」と誤解するので、押せない形にして理由と
                代替の手順を添える。
              */}
              <button
                type="button"
                disabled
                title="この画面からのテスト送信にはまだ対応していません"
                className="bg-canvas text-ink rounded-control mt-4 w-full px-4 py-2 text-sm font-semibold opacity-50"
              >
                自分に送って確かめる
              </button>
              {/*
                80% の白字だと帯の上で 4.5:1 に届かない。100% の白字にする。
                NEXT-24: 押せない形＋理由＋代替手順のまま残す（無反応に見せない）。
              */}
              <p className="text-on-accent mt-2 text-xs leading-relaxed">
                この画面からのテスト送信にはまだ対応していません。保存して一斉配信に組み込むと、配信の画面からテスト送信できます。
              </p>
            </section>
          </aside>
          <div className="min-w-0 flex-1 space-y-4 xl:order-1">
          <div className="bg-canvas rounded-card border-hairline border p-5">
            <Field label="テンプレート名" htmlFor="cr-name" required>
              <input
                id="cr-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </Field>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              <label className="text-ink-faint">
                置き場：
                <SelectField
                  aria-label="置き場"
                  value={folderId ?? ''}
                  onChange={(e) => setFolderId(e.target.value || null)}
                  options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
                />
              </label>
              <span className="text-ink-faint">種別：カルーセル</span>
              <span className="text-ink tabular-nums">
                {panels.length} / {MAX_COLUMNS} パネル
              </span>
            </div>
          </div>

          <div className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">パネル</p>
            <p className="text-ink-faint mt-0.5 text-xs">
              左から順に表示されます。順番は下の各パネルの「←」「→」で入れ替えられます。
            </p>
            <ol className="mt-2 flex flex-wrap gap-1.5">
              {panels.map((panel, i) => (
                <li
                  key={i}
                  className="border-hairline text-ink-secondary rounded-pill border px-3 py-1 text-xs"
                >
                  パネル {i + 1}
                  {panel.title ? `：${panel.title}` : ''}
                </li>
              ))}
            </ol>
          </div>

          {panels.map((panel, i) => (visual && i !== 1 ? null : (
            <div key={i} className="bg-canvas rounded-card border-hairline space-y-4 border p-5">
              <div className="flex items-center justify-between">
                <p className="text-ink text-sm font-semibold">パネル {i + 1} の内容</p>
                <div className="flex items-center gap-1">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`パネル ${i + 1} を左へ移動`}
                  title={i === 0 ? 'いちばん左です' : '左へ移動'}
                  className="text-ink-secondary hover:bg-canvas-sunken rounded px-2 py-1 text-xs disabled:opacity-40"
                >
                  ←
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === panels.length - 1}
                  aria-label={`パネル ${i + 1} を右へ移動`}
                  title={i === panels.length - 1 ? 'いちばん右です' : '右へ移動'}
                  className="text-ink-secondary hover:bg-canvas-sunken rounded px-2 py-1 text-xs disabled:opacity-40"
                >
                  →
                </button>
                <button
                  onClick={() =>
                    setPanels((prev) =>
                      prev.length >= MAX_COLUMNS
                        ? prev
                        : [...prev.slice(0, i + 1), { ...prev[i], actions: [...prev[i].actions] }, ...prev.slice(i + 1)],
                    )
                  }
                  disabled={panels.length >= MAX_COLUMNS}
                  title={panels.length >= MAX_COLUMNS ? `パネルは${MAX_COLUMNS}枚までです` : undefined}
                  className="text-ink-secondary hover:bg-canvas-sunken rounded px-2 py-1 text-xs disabled:opacity-40"
                >
                  複製
                </button>
                {panels.length > 1 && (
                  <button
                    onClick={() => setPanels((prev) => prev.filter((_, j) => j !== i))}
                    className="text-danger hover:bg-danger-bg rounded px-2 py-1 text-xs"
                  >
                    削除
                  </button>
                )}
                </div>
              </div>

              <Field
                label="画像のURL"
                htmlFor={`cr-panel-${i}-image`}
                note="画像を入れるなら、全部の枚に入れてください。1枚だけ無いと、その枚だけ高さが変わって崩れます。"
              >
                <input
                  id={`cr-panel-${i}-image`}
                  type="url"
                  value={panel.thumbnailImageUrl}
                  onChange={(e) => update(i, { thumbnailImageUrl: e.target.value })}
                  placeholder="https://example.com/a.png"
                  className={inputClass}
                />
              </Field>

              <Field label="パネルタイトル" htmlFor={`cr-panel-${i}-title`} note={`${TITLE_MAX}文字まで`}>
                <input
                  id={`cr-panel-${i}-title`}
                  type="text"
                  value={panel.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  className={inputClass}
                />
                {[...panel.title].length > TITLE_MAX && (
                  <p className="text-danger mt-1 text-xs">
                    {[...panel.title].length} 文字。{TITLE_MAX}文字までです。
                  </p>
                )}
              </Field>

              <Field
                label="パネル本文"
                htmlFor={`cr-panel-${i}-text`}
                required
                note={
                  anyImage
                    ? `画像があるため${TEXT_MAX_WITH_IMAGE}文字までです。`
                    : `${TEXT_MAX_WITHOUT_IMAGE}文字まで（画像を入れると${TEXT_MAX_WITH_IMAGE}文字になります）。`
                }
              >
                <textarea
                  id={`cr-panel-${i}-text`}
                  rows={3}
                  value={panel.text}
                  onChange={(e) => update(i, { text: e.target.value })}
                  className={`${inputClass} resize-y`}
                />
                <p
                  className={`mt-1 text-xs tabular-nums ${
                    [...panel.text].length > textMax ? 'text-danger' : 'text-ink-faint'
                  }`}
                >
                  {[...panel.text].length} / {textMax}
                </p>
              </Field>

              <div>
                <p className="text-ink-secondary mb-2 text-sm font-medium">
                  このパネルの選択肢（最大{MAX_ACTIONS}つ）
                </p>
                {panel.actions.map((action, ai) => (
                  <div key={ai} className="border-hairline mb-2 rounded-lg border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={action.label}
                        onChange={(e) =>
                          update(i, {
                            actions: panel.actions.map((a, j) =>
                              j === ai ? { ...a, label: e.target.value } : a,
                            ),
                          })
                        }
                        placeholder="ボタンの文字"
                        aria-label={`パネル${i + 1}の選択肢${ai + 1}の文字`}
                        className={`${inputClass} w-40`}
                      />
                      <div className="flex gap-1.5">
                        {(
                          [
                            { value: 'uri' as const, label: 'URLを開く' },
                            { value: 'action' as const, label: '押されたときに何かする' },
                          ]
                        ).map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() =>
                              update(i, {
                                actions: panel.actions.map((a, j) =>
                                  j === ai ? { ...a, kind: o.value } : a,
                                ),
                              })
                            }
                            className={`rounded-control px-2.5 py-1 text-xs ${action.kind === o.value ? 'bg-accent-deep text-on-accent' : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                      {panel.actions.length > 1 && (
                        <button
                          onClick={() =>
                            update(i, { actions: panel.actions.filter((_, j) => j !== ai) })
                          }
                          className="text-danger hover:bg-danger-bg ml-auto rounded px-2 text-xs"
                        >
                          外す
                        </button>
                      )}
                    </div>

                    {action.kind === 'uri' ? (
                      <input
                        type="url"
                        value={action.uri}
                        onChange={(e) =>
                          update(i, {
                            actions: panel.actions.map((a, j) =>
                              j === ai ? { ...a, uri: e.target.value } : a,
                            ),
                          })
                        }
                        placeholder="https://example.com"
                        aria-label={`パネル${i + 1}の選択肢${ai + 1}のURL`}
                        className={`${inputClass} w-full`}
                      />
                    ) : (
                      <div className="space-y-2">
                        <InlineActionList
                          actions={action.actions}
                          onChange={(next) =>
                            update(i, {
                              actions: panel.actions.map((a, j) =>
                                j === ai ? { ...a, actions: next } : a,
                              ),
                            })
                          }
                          tags={actionOptions.tags}
                          fields={actionOptions.fields}
                          marks={actionOptions.marks}
                          scenarios={actionOptions.scenarios}
                          vars={actionOptions.vars}
                        />
                        {action.actions.length === 0 && (
                          <p className="text-warning text-[11px]">
                            何も設定されていません。押されても何も起きません。
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {panel.actions.length < MAX_ACTIONS && (
                  <button
                    onClick={() =>
                      update(i, { actions: [...panel.actions, emptyChoice()] })
                    }
                    className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-xs"
                  >
                    ＋ 選択肢を追加
                  </button>
                )}
              </div>
            </div>
          )))}

          <section className="bg-canvas rounded-card border-hairline space-y-3 border p-5">
            <div>
              <p className="text-ink text-sm font-semibold">押せる回数</p>
              <p className="text-ink-faint mt-0.5 text-xs leading-relaxed">
                「押されたときに何かする」ボタンだけが対象です。URLを開くボタンは、LINE の外へ
                出るので数えられません。
              </p>
            </div>
            <div className="space-y-1">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="tap-limit"
                  checked={tapLimitMode === 'none'}
                  onChange={() => setTapLimitMode('none')}
                  className="mt-0.5"
                />
                <span className="text-sm">何度でも押せる</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="tap-limit"
                  checked={tapLimitMode === 'once'}
                  onChange={() => setTapLimitMode('once')}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  1人につき1回だけ
                  <span className="text-ink-faint block text-[11px]">
                    このカルーセル全体で1回です。どのボタンを押しても、次からは動きません。
                  </span>
                </span>
              </label>
            </div>

            {tapLimitMode === 'once' && (
              <Field
                label="2回目に押されたときの返事"
                htmlFor="cr-limit-text"
                note="空にすると、何も返さず黙って何も起きません。"
              >
                <input
                  id="cr-limit-text"
                  type="text"
                  value={tapLimitText}
                  onChange={(e) => setTapLimitText(e.target.value)}
                  placeholder="例：こちらはすでに受け付けています。"
                  className={inputClass}
                />
              </Field>
            )}
          </section>

          {panels.length < MAX_COLUMNS && (
            <button
              onClick={() => setPanels((prev) => [...prev, emptyPanel()])}
              className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium"
            >
              パネルを追加（{panels.length} / {MAX_COLUMNS}）
            </button>
          )}

          {error && (
            <Notice
              tone="danger"
              message={error}
              action={saveFailed ? (
                /*
                 * N-149: 原因だけ出して止めると、人は「入力が消えたか」と
                 * 不安になる。残っていることと、やり直す口を一緒に出す。
                 */
                <span className="text-xs">
                  <span>入力した内容はそのまま残っています。</span>
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="text-action hover:underline ml-2 font-medium disabled:opacity-40"
                  >
                    もう一度保存する
                  </button>
                </span>
              ) : undefined}
            />
          )}

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">届き方</p>
            <p className="text-ink-faint mt-0.5 mb-3 text-xs">横にスワイプして見えます</p>
            <div className="bg-canvas-sunken rounded-card overflow-x-auto p-3">
              <div className="flex gap-2">
                {panels.map((panel, i) => (
                  <div key={i} className="w-56 shrink-0 overflow-hidden rounded-2xl bg-white">
                    {typeof panel.thumbnailImageUrl === 'string' && /^https?:\/\//.test(panel.thumbnailImageUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={panel.thumbnailImageUrl} alt="" className="h-28 w-full object-cover" />
                    ) : (
                      <div className="bg-canvas-sunken text-ink-faint flex h-28 items-center justify-center text-xs">
                        画像なし
                      </div>
                    )}
                    <div className="p-3">
                      <p className="text-ink truncate text-sm font-medium">
                        {panel.title || '（タイトル）'}
                      </p>
                      <p className="text-ink-faint mt-1 line-clamp-2 text-xs">{panel.text}</p>
                      <div className="mt-2 space-y-1">
                        {panel.actions.map((a, j) => (
                          <p
                            key={j}
                            className="border-hairline text-accent-deep rounded-control border px-2 py-1 text-center text-xs"
                          >
                            {a.label || '（ボタン）'}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-ink-faint mt-2 text-xs">
              {panels.length}枚のパネルを横に並べて送ります
            </p>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">ボタン別のタップ数</p>
            {/* どのボタンが押されたかを記録していない。カルーセルのアクションは
                LINE 側で処理され、こちらに戻ってこない。 */}
            <p className="text-ink-faint mt-1 text-xs leading-relaxed">
              ボタンごとのタップ数はまだ取れません。リンクを開くボタンなら、短縮URLのクリックとして「分析 → URLクリック」で見られます。
            </p>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">気をつけること</p>
            <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
              <li>・パネルは{MAX_COLUMNS}枚まで。多いと最後まで見てもらえません</li>
              <li>・ボタンは1パネルにつき{MAX_ACTIONS}つまでです（LINEの仕様）</li>
              <li>・パネル本文は{TEXT_MAX_WITH_IMAGE}文字まで。超えると途中で切れて表示されます</li>
              <li>
                ・画像は横1024 × 縦678pxを推奨。比率は 1.51:1 か 1:1 のどちらかに揃えてください
              </li>
              <li className="sr-only">
                ・画像は横1024px以上を推奨。比率は 1.51:1 か 1:1 のどちらかに揃えてください
              </li>
              <li>・パネルごとに画像の比率が違うと、表示が崩れます</li>
            </ul>
          </section>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={saving || loadFailed}
              className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <Link
              href="/templates"
              className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control px-4 py-2 text-sm font-medium"
            >
              キャンセル
            </Link>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CarouselEditorPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <CarouselEditorInner />
    </Suspense>
  )
}

/*
 * 試験から触れる口。**画面を組み立て直さずに、実際に動く部品を呼ぶ。**
 * ここに出すのは、画面本体がそのまま使っている関数と部品だけ。
 */
const CarouselEditorPageWithTestSupport = Object.assign(CarouselEditorPage, {
  __testing: {
    CarouselEditorInner,
    buildCarouselActions,
    buildCarouselContent,
    saveCarousel,
  },
})

export default CarouselEditorPageWithTestSupport
