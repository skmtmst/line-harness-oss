import type {
  FriendAddRouting,
  FriendAddRoutingVersion,
  LineAccount,
  Scenario,
  StaffMember,
} from '@line-crm/shared'

/**
 * 設計 ★V6 34-1「はじめの設定」（`RAW35`）の順路。
 *
 * **画面を開いたかではなく、実際に作られたもので判断する。**
 * だから判定はすべてサーバから取った実物（アカウント・タグ・ルール・シナリオ）
 * から計算し、画面側に「見た」印は一切持たない。
 *
 * 判定は画面から切り離してここに置く。契約テストで文言ごと固定する。
 */

/** 段の状態。**「まだです」と「止まっています」を言い分ける。** */
export type StepState =
  /** 終わりました */
  | 'done'
  /** 止まっています（作りかけがあるのに動いていない） */
  | 'stalled'
  /** まだです（手つかず） */
  | 'todo'
  /** 権限がありません */
  | 'forbidden'
  /** 確かめられません（数える口がまだ無い） */
  | 'unknown'

export const STEP_STATE_LABEL: Record<StepState, string> = {
  done: '終わりました',
  stalled: '止まっています',
  todo: 'まだです',
  forbidden: '権限がありません',
  unknown: '確かめられません',
}

export type StepKey = 'accounts' | 'attributes' | 'friendAdd' | 'scenario' | 'firstMessage'

export interface StepResult {
  key: StepKey
  /** 左の丸に出す文字。最終段だけ数字ではなく「最終」。 */
  ordinal: string
  title: string
  state: StepState
  /** 終わったと見なす条件。状態によらず必ず出す。 */
  condition: string
  /** 次にすること。 */
  next: string
  /** 行き先。押せないときは null。 */
  action: { label: string; href: string } | null
  /** 押せないときの理由。押せるときは null。 */
  blockedReason: string | null
}

/** 判定に使う実物。**足りないものは `null` で受け、勝手に「終わった」ことにしない。** */
export interface GettingStartedInput {
  accounts: LineAccount[]
  tagCount: number
  friendFieldCount: number
  /*
    `routing` は無いことがある。**「設定した」と「中身が読めた」は別。**
    実画面（撮影ハーネス）で `configured` だけ返って `routing` が来ず、
    ここで落ちた。型が言い切っていても、外から来る値は疑う。
  */
  friendAdd: { configured: boolean; routing?: FriendAddRouting | null } | null
  friendAddDraft: FriendAddRoutingVersion | null
  scenarios: Scenario[]
  role: StaffMember['role'] | null
}

/**
 * 見る・直すの区別。閲覧者は最終確認（実際に送る）を進められない。
 *
 * **役割が読めなかったとき（`null`）を「権限がない」と読まない。**
 * 読めないのと、無いのは違う。読めないときは止めず、確かめられないと言う。
 */
function isViewer(role: StaffMember['role'] | null): boolean {
  return role === 'viewer'
}

/**
 * 段1 LINEアカウントをつなぐ。
 *
 * 稼働中で、Webhook が合っていて、シークレットが確かめられている——3つとも要る。
 * **`webhook.status` が `unknown`（まだ確かめていない）を「合っている」と読まない。**
 */
function accountsStep(input: GettingStartedInput): StepResult {
  const usable = input.accounts.filter(
    (a) => a.isActive && a.webhook?.status === 'matched' && a.channelSecretConfigured === true,
  )
  const done = usable.length > 0
  const hasAny = input.accounts.length > 0
  return {
    key: 'accounts',
    ordinal: '1',
    title: 'LINEアカウントをつなぐ',
    state: done ? 'done' : hasAny ? 'stalled' : 'todo',
    condition:
      '稼働中のアカウントが1つ以上あり、Webhookが合っていて、シークレットが確かめられている',
    next: done
      ? '終わっています。つなぎ先を見直したいときはこちらから。'
      : hasAny
        ? 'アカウントはありますが、Webhookかシークレットがまだ確かめられていません。'
        : 'LINEアカウントを1つ登録して、Webhookをつなぎます。',
    action: { label: done ? '接続の確認を見る' : 'LINEアカウントを開く', href: '/accounts' },
    blockedReason: null,
  }
}

/** 段2 友だちの分け方を決める。タグか友だち情報欄が1つでもあればよい。 */
function attributesStep(input: GettingStartedInput): StepResult {
  const done = input.tagCount > 0 || input.friendFieldCount > 0
  return {
    key: 'attributes',
    ordinal: '2',
    title: '友だちの分け方を決める',
    state: done ? 'done' : 'todo',
    condition: 'タグか友だち情報欄が1つ以上ある',
    next: done
      ? '終わっています。タグを増やすときはこちらから。'
      : 'タグを1つ作ると、友だちを分けて配信できるようになります。',
    action: { label: 'タグを見る', href: '/tags' },
    blockedReason: null,
  }
}

/**
 * 段3 友だち追加時の配信を作る。
 *
 * 「どれにも当たらない人を受ける決まり」＝ 以前からの友だち側の分岐。
 * この仕組みでは、はじめての人と以前からの人の2つで全員を受けるので、
 * **公開されていれば受け皿は必ずある。**
 */
function friendAddStep(input: GettingStartedInput): StepResult {
  const published = input.friendAddDraft?.publishedAt != null
  const hasDraft = input.friendAdd?.configured === true || input.friendAddDraft != null
  const done = published && input.friendAdd?.configured === true
  return {
    key: 'friendAdd',
    ordinal: '3',
    title: '友だち追加時の配信を作る',
    state: done ? 'done' : hasDraft ? 'stalled' : 'todo',
    condition: '公開したルールが1つ以上あり、どれにも当たらない人を受ける決まりがある',
    next: done
      ? '終わっています。振り分けを見直したいときはこちらから。'
      : hasDraft
        ? '下書きがありますが、まだ公開していません。公開すると動きはじめます。'
        : '友だちが増えたときに何をするかを決めて、公開します。',
    action: { label: '友だち追加時の配信を開く', href: '/friend-add-settings' },
    blockedReason: null,
  }
}

/**
 * 段4 シナリオを作る。
 *
 * 「段3のルールから始まる」＝ 友だち追加時の振り分けが指しているシナリオであること。
 * 公開シナリオがあっても、段3から始まらなければ順路としては終わっていない。
 */
function scenarioStep(input: GettingStartedInput): StepResult {
  const active = input.scenarios.filter((s) => s.isActive)
  const startedIds = new Set(
    [input.friendAdd?.routing?.firstTime?.scenarioId, input.friendAdd?.routing?.returning?.scenarioId]
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
  const done = active.some((s) => startedIds.has(s.id))
  const hasAny = input.scenarios.length > 0
  return {
    key: 'scenario',
    ordinal: '4',
    title: 'シナリオを作る',
    state: done ? 'done' : hasAny ? 'stalled' : 'todo',
    condition: '公開したシナリオが1つ以上あり、段3のルールから始まる',
    next: done
      ? '終わっています。中身を直すときはこちらから。'
      : hasAny
        ? 'シナリオはありますが、段3のルールから始まるものがまだありません。'
        : 'レシピから作ると、7通ぶんの下書きが一度にできます。',
    action: hasAny
      ? { label: 'シナリオを開く', href: '/scenarios' }
      : { label: 'レシピから作る', href: '/recipes' },
    blockedReason: null,
  }
}

/**
 * 最終確認 最初の1通を受け取る。
 *
 * **数えられない。** 「1通目が実際に届いたか」を返す口がまだ無い
 * （要件 §6-1 は `messages_log` の `succeeded` を見ると決めているが、
 * 画面から引ける口が用意されていない）。
 * 数を作らず、確かめられないことをそのまま言う。
 */
function firstMessageStep(input: GettingStartedInput): StepResult {
  const allowed = !isViewer(input.role)
  return {
    key: 'firstMessage',
    ordinal: '最終',
    title: '最初の1通を受け取る',
    state: allowed ? 'unknown' : 'forbidden',
    condition: '友だち追加時の配信かシナリオの1通目が、実際に1件届いている',
    next: allowed
      ? '届いたかどうかを数える口がまだありません。QRを読んで自分を友だちに追加するか、テスト受信者へ送って、受信箱で確かめてください。'
      : 'QRを読んで自分を友だちに追加するか、テスト受信者へ送ります。',
    action: allowed ? { label: 'ダッシュボードでQRを見る', href: '/' } : null,
    blockedReason: allowed ? null : '管理者に頼んでください',
  }
}

export function buildSteps(input: GettingStartedInput): StepResult[] {
  return [
    accountsStep(input),
    attributesStep(input),
    friendAddStep(input),
    scenarioStep(input),
    firstMessageStep(input),
  ]
}

/** 終わった段の数。**`unknown` は終わっていない側に数える。** */
export function doneCount(steps: ReadonlyArray<StepResult>): number {
  return steps.filter((s) => s.state === 'done').length
}

/** 全部終わったか。ダッシュボードの帯を出すかどうかがこれで決まる。 */
export function allDone(steps: ReadonlyArray<StepResult>): boolean {
  return steps.every((s) => s.state === 'done')
}

/** 見出しの1行。数には単位を付ける（common-rules）。 */
export function progressHeadline(steps: ReadonlyArray<StepResult>): string {
  const done = doneCount(steps)
  const next = steps.find((s) => s.state !== 'done')
  if (!next) return `はじめの設定 ${done} / ${steps.length} が完了。すべて終わりました。`
  return `はじめの設定 ${done} / ${steps.length} が完了。次は「${next.title}」です。`
}

/**
 * いま止まっている理由。**止まっている段と、権限で進めない段を分けて言う。**
 * 何も無ければ空配列（帯を描かない）。
 */
export function stoppedReasons(steps: ReadonlyArray<StepResult>): string[] {
  const lines: string[] = []
  const stalled = steps.find((s) => s.state === 'stalled')
  if (stalled) lines.push(`段${stalled.ordinal}で止まっています。${stalled.next}`)
  const forbidden = steps.filter((s) => s.state === 'forbidden')
  for (const step of forbidden) {
    lines.push(`「${step.title}」は、あなたの権限では進められません。管理者に頼んでください。`)
  }
  const unknown = steps.filter((s) => s.state === 'unknown')
  for (const step of unknown) {
    lines.push(`「${step.title}」は、いまの仕組みでは自動で確かめられません。${step.next}`)
  }
  return lines
}

/** 右カラムの「つながる先」。要件 §5-2 のとおり 33・04・09・05・01 だけ。 */
export const FEATURE_LINKS = [
  { label: 'LINEアカウント', note: 'つなぎ先と接続の状態はここで見ます。', href: '/accounts' },
  { label: '友だち属性', note: 'タグと友だち情報欄はここで作ります。', href: '/tags' },
  {
    label: '友だち追加時の配信',
    note: '段3のルールはここにあります。',
    href: '/friend-add-settings',
  },
  { label: 'シナリオ配信', note: '段4のシナリオはここにあります。', href: '/scenarios' },
  { label: 'ダッシュボード', note: '友だち追加のQRはここに出ます。', href: '/' },
] as const

/** 右カラムの「気をつけること」。設計 `RAW35` の 3 行。 */
export const CARE_ITEMS = [
  {
    head: '終わったかどうかは、画面を開いたかではなく、実際に作られたもので判断します。',
  },
  {
    head: '順番は飛ばせます。',
    note: '前の段が終わっていなくても、後の段の画面は開けます。',
  },
  {
    head: '全部終わると、ダッシュボードの帯は出なくなります。',
    note: 'ここからならいつでも見返せます。',
  },
] as const
