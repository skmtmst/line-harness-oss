/*
 * カルーセル編集の中身の組み立てと保存。★V7 の carousel/page.tsx と
 * ★V8 の carousel-v8.tsx が同じ正本を見るための共有モジュール。
 * （page.tsx は Next.js の決まりで自由な export を持てない）
 */
import { api } from '@/lib/api'
import { toActionPayload, type InlineAction } from '@/components/auto-replies/draft-fields'

export const MAX_COLUMNS = 10
export const MAX_ACTIONS = 3
export const TITLE_MAX = 40
export const TEXT_MAX_WITH_IMAGE = 60
export const TEXT_MAX_WITHOUT_IMAGE = 120

/** 選択肢1つぶん。 */
export interface Choice {
  label: string
  /** 'uri'（URLを開く）か 'action'（押されたときに何かする）。 */
  kind: 'uri' | 'action'
  uri: string
  /** kind='action' のときに実行する並び。 */
  actions: InlineAction[]
}

export interface Panel {
  thumbnailImageUrl: string
  title: string
  text: string
  actions: Choice[]
}

export function emptyChoice(): Choice {
  return { label: '', kind: 'uri', uri: '', actions: [] }
}

export function emptyPanel(): Panel {
  return { thumbnailImageUrl: '', title: '', text: '', actions: [emptyChoice()] }
}

export function visualPanels(): Panel[] {
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
export function buildCarouselContent(panels: Panel[], templateId: string): string {
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
export function buildCarouselActions(panels: Panel[]): Record<string, Record<string, unknown[]>> {
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

/**
 * D009: 未保存の見分けに入れる中身。保存の口へ送る項目とそろえる。
 * `createdId` は人の入力ではないので入れない。
 */
export interface CarouselDirtyState {
  name: string
  panels: Panel[]
  folderId: string | null
  tapLimitMode: 'none' | 'once'
  tapLimitText: string
}

/**
 * D009: 保存ずみの正本と今の入力を同じ形の文字にする。1文字でも違えば
 * 「保存していない変更がある」とする。比べるのは値だけで、順番も含める
 * （パネルの並び替えも失われる作業のため）。
 */
export function carouselSnapshot(state: CarouselDirtyState): string {
  return JSON.stringify(state)
}

export interface CarouselSaveInput {
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

export type CarouselSaveResult =
  | {
      ok: true
      /** ★V8「保存して公開」が直後に公開口へ渡す保存先の id。 */
      id: string
    }
  | {
      ok: false
      error: string
      /**
       * N-149: 作成だけ済んで後段が失敗したとき、その id を返す。
       * 画面はこれを覚えて、再試行を「作成し直し」ではなく「更新」にする。
       */
      createdId?: string
    }

export interface CarouselSaveOps {
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
export async function saveCarousel(
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
      return res.success ? { ok: true, id: input.templateId } : fail(res.error)
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
    return { ok: true, id: createdId }
  } catch (e) {
    return fail(e instanceof Error ? e.message : '保存に失敗しました。通信を確かめて、もう一度お試しください。')
  }
}
