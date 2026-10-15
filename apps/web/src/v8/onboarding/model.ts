import type { AccountStyle, SetupAnswer } from '@line-crm/shared'
import type { StarterSetItem } from '@/lib/api-styles'
import { PREPARING_WORD } from '@/components/shared/preparing-dialog'

/*
 * はじめの質問（B-313）と初期セット（B-311）の決まりを画面から切り離した表。
 * 絵：修正案 DIHFx の列 VHp7p（xxpM9・RZW83・lS1Gh・rJ36f・oKSsG・Bdfxm）。
 * 口：組4（`lib/api-styles.ts` の styleApi）。質問のキーは口の `questionKeys`
 * （image/booking/approval/payment/reminders/stamps/coupons/tickets/outcome/content）だけ。口に無い質問は置かない（未定は入れない）。
 *
 * - どの質問にも「あとで設定する」「手動で設定する」がある（B-313 追記）。あとで＝何も入れない・
 *   はじめにやることに残る。手動＝その設定の画面へ案内する。
 * - おすすめの答えは業種ごとに先に選んでおく（飛ばしても困らない）。
 * - どの質問にも「あとから変えられます（どこで）」を出す。
 */

export type IconKey =
  | 'utensils' | 'scissors' | 'messages' | 'graduation' | 'bag' | 'grid'
  | 'sparkles' | 'image' | 'folder' | 'download' | 'hourglass' | 'settings'
  | 'circleCheck' | 'userCheck' | 'store' | 'card' | 'split' | 'calendarCheck' | 'clock' | 'bell' | 'bellOff'
  | 'stamp' | 'ticket' | 'ban' | 'users' | 'user' | 'file'

export const STYLE_CHOICES: ReadonlyArray<{ value: AccountStyle; icon: IconKey; label: string; note: string }> = [
  { value: 'restaurant', icon: 'utensils', label: '飲食店向け', note: '席・コースの予約、前日のお知らせ、来店スタンプ' },
  { value: 'salon', icon: 'scissors', label: 'サロン', note: '担当者の指名・空き枠、回数券、次回予約' },
  { value: 'consult', icon: 'messages', label: '面談・相談', note: '担当を自動で割り当て、オンライン／対面、資料' },
  { value: 'lesson', icon: 'graduation', label: '教室・レッスン', note: 'クラスの定員、回数券・月謝、振替' },
  { value: 'ec', icon: 'bag', label: 'ECサイト', note: '商品のお知らせ、カゴ落ち、再入荷' },
  { value: 'standard', icon: 'grid', label: '標準', note: '配信と受信箱だけで始める（あとで足せます）' },
]

export function styleLabel(style: AccountStyle): string {
  return STYLE_CHOICES.find((choice) => choice.value === style)?.label ?? '標準'
}

/** 1問の選択肢。value は画面の値（'true'/'false' は口へ真偽で送る）。 */
export type Choice = {
  value: string; icon: IconKey; label: string; note: string
  /** 口へ送る値が画面の値と違うとき（承認の「manual」は「手動で設定する」と同じ値になるので画面では分ける）。 */
  apiValue?: string
}

export type Question = {
  /** 口の質問キー。 */
  key: string
  /** 左の一覧と進みの右に出す短い名前。 */
  short: string
  title: string
  description: string
  choices: Choice[]
  /** スタイルごとのおすすめ（無ければ最初の選択肢）。 */
  recommended?: Partial<Record<AccountStyle, string>>
  /** 「あとから変えられます（ここ）。」の（）の中。 */
  where: string
  /** 手動で設定するときに開く画面と、そのカードの説明。 */
  manualHref: string
  manualNote: string
  /** 選んだ答えに付ける帯（お支払いの Stripe の案内など）。 */
  info?: string
  /** あとで設定したとき、はじめにやること・最後の一覧に出す文。 */
  todo: { title: string; note: string; action: string }
  /** 最後の一覧「入れなかった物」の説明。無ければ todo.note。 */
  skipped?: string
  /** 最後の一覧「入れなかった物」の題。無ければ short。 */
  skippedTitle?: string
  /** 設定の画面がまだ無いときの機能の名前。押すと準備中の窓（B-314）。 */
  preparing?: string
  /**
   * 口（組4）がまだこの質問のキーを受け付けない。答えは画面の中だけで持ち、保存しない（札「準備中」）。
   * 口が受け付けたら、ここを外して API_QUESTION_KEYS に足すだけでつながる。
   */
  pendingApi?: boolean
}

/** 口が受け付ける質問のキー（組4 `questionKeys`）。保存はこのキーだけ送る。 */
export const API_QUESTION_KEYS = ['image', 'booking', 'approval', 'payment', 'reminders', 'stamps', 'coupons', 'tickets', 'outcome', 'content', 'cancelDeadline', 'seats', 'hours', 'partySize', 'nomination', 'assignment', 'classCapacity'] as const

/** 保存する答え：口のキーだけ。予約の確定の仕方を答えた（その場で／承認）＝予約を使う、を booking に写す。 */
export function answersForApi(answers: Record<string, SetupAnswer>): Record<string, SetupAnswer> {
  const out = Object.fromEntries(Object.entries(answers).filter(([key]) => (API_QUESTION_KEYS as readonly string[]).includes(key)))
  if (!out.booking && answers.approval?.mode === 'configured') out.booking = { mode: 'configured', value: true }
  return out
}

const RULES = '/booking/menus?tab=rules'
const yesNo = (yes: Omit<Choice, 'value'>, no: Omit<Choice, 'value'>): Choice[] => [{ value: 'true', ...yes }, { value: 'false', ...no }]

const Q: Record<string, Question> = {
  booking: {
    key: 'booking', short: '予約の受け付け', title: 'LINE で予約を受け付けますか？', description: '予約メニューの見本を止めた状態で入れます。最後に確かめてから動かします。',
    choices: yesNo(
      { icon: 'calendarCheck', label: '受け付ける', note: 'リッチメニューの「予約する」から予約できます' },
      { icon: 'ban', label: '受け付けない', note: '予約メニューは入れません' },
    ),
    recommended: { ec: 'false', standard: 'false' },
    where: '予約設定', manualHref: '/booking/menus', manualNote: '予約設定の画面を開きます',
    todo: { title: '予約の受け付けを決める', note: '予約メニューと営業時間を入れると予約できます', action: '決める' },
  },
  approval: {
    key: 'approval', short: '予約の確定の仕方', title: '予約はその場で確定しますか？', description: 'お客さまが LINE で予約したときの扱いです。',
    choices: [
      { value: 'automatic', icon: 'circleCheck', label: 'その場で確定する', note: '空いていれば、すぐに予約が決まります。' },
      { value: 'require_approval', apiValue: 'manual', icon: 'userCheck', label: 'お店が承認してから確定する', note: '届いた予約を見て、お店が［承認する］を押すと決まります' },
    ],
    recommended: { consult: 'require_approval' },
    where: '予約設定 › 予約のルール', manualHref: RULES, manualNote: '予約のルールの画面を開きます',
    todo: { title: '予約の確定の仕方を決める', note: 'その場で確定するか、お店が承認するかを選びます', action: '決める' },
  },
  payment: {
    key: 'payment', short: 'お支払い', title: '予約のときのお支払いはどうしますか？', description: 'コース・メニューごとにあとで変えられます。',
    choices: [
      { value: 'store', icon: 'store', label: 'お店で払う', note: '来店したときにお店で払います。今までどおりです' },
      { value: 'online', icon: 'card', label: 'オンラインで先払い', note: '予約のときにカードで払います。Stripe をつなぐと使えます' },
      { value: 'customer_choice', icon: 'split', label: 'お客さまが選ぶ', note: '先払いか、お店で払うかをお客さまが選びます' },
    ],
    where: '予約設定 › お支払い', manualHref: '/booking/menus', manualNote: 'お支払いの画面を開きます',
    info: 'オンラインで払うには Stripe をつなぎます。つなぐまではお店で払うだけで動き、つないだ後も最初は試験モード（本当の請求は起きません）です。',
    todo: { title: 'Stripe をつなぐ', note: 'オンライン先払いを使うときに必要です', action: 'つなぐ' },
    skipped: 'Stripe をつなぐまではお店で払うだけです。つなぐと最初は試験モードです',
    skippedTitle: 'お支払い（オンライン）',
    preparing: 'お支払い',
  },
  reminders: {
    key: 'reminders', short: '前日のお知らせ', title: '予約の前日にお知らせを送りますか？', description: '予約の確定・前日のお知らせを自動で送ります。最初は止めた状態で入り、最後に確かめてから動かします。',
    choices: yesNo(
      { icon: 'bell', label: '前日の 18:00 に送る', note: '予約の日時・場所・キャンセルの方法を送ります' },
      { icon: 'bellOff', label: '送らない', note: 'お知らせは入れません' },
    ),
    where: 'リマインダ', manualHref: '/reminders', manualNote: 'リマインダの画面を開きます',
    todo: { title: '予約のお知らせを決める', note: '予約のあとに LINE で送るお知らせです', action: '決める' },
  },
  stamps: {
    key: 'stamps', short: '来店スタンプ', title: '来店スタンプを使いますか？', description: '来店ごとにスタンプを押し、たまったら特典を渡します。',
    choices: yesNo(
      { icon: 'stamp', label: '使う', note: 'リッチメニューに「ポイントカード」を入れます。決まりは来店スタンプの画面で入れます' },
      { icon: 'ban', label: '使わない', note: 'リッチメニューにスタンプのボタンを入れません' },
    ),
    recommended: { consult: 'false' },
    where: '来店スタンプ', manualHref: '/visit-stamps', manualNote: '来店スタンプの画面を開きます',
    todo: { title: '来店スタンプの決まりを入れる', note: 'リッチメニューにボタンがあるのに中身が未設定です', action: '決まりを入れる' },
    skipped: `リッチメニューの「スタンプ」は、お客さまには「${PREPARING_WORD}」と出ます`,
  },
  coupons: {
    key: 'coupons', short: 'クーポン', title: 'クーポンを使いますか？', description: 'リッチメニューや配信からクーポンを開けるようにします。',
    choices: yesNo(
      { icon: 'ticket', label: '使う', note: 'クーポンの案内の見本を入れます。中身はあとで変えられます' },
      { icon: 'ban', label: '使わない', note: 'クーポンは入れません' },
    ),
    recommended: { consult: 'false', lesson: 'false' },
    where: 'クーポン', manualHref: '/templates', manualNote: 'テンプレートの画面を開きます',
    todo: { title: 'クーポンを決める', note: 'お客さまに出すクーポンです', action: '決める' },
    preparing: 'クーポン',
  },
  tickets: {
    key: 'tickets', short: '回数券', title: '回数券・月謝を使いますか？', description: '回数券や月謝の残りを、お客さまが LINE で見られるようにします。',
    choices: yesNo(
      { icon: 'ticket', label: '使う', note: 'リッチメニューから残りを見られます' },
      { icon: 'ban', label: '使わない', note: '回数券は入れません' },
    ),
    where: '予約設定 › 回数券', manualHref: '/booking/menus', manualNote: '回数券の画面を開きます',
    todo: { title: '回数券を決める', note: '回数券や月謝の残りを見せます', action: '決める' },
    preparing: '回数券',
  },
  outcome: {
    key: 'outcome', short: '面談の結果', title: '面談の結果を記録しますか？', description: '面談のあとに「検討中・成約・見送り」を残して、成約率を数えます。',
    choices: yesNo(
      { icon: 'circleCheck', label: '記録する', note: '面談のあとに結果を入れる欄を出します' },
      { icon: 'ban', label: '記録しない', note: '結果の欄は出しません' },
    ),
    where: '予約設定', manualHref: '/booking/menus', manualNote: '予約設定の画面を開きます',
    todo: { title: '面談の結果の記録を決める', note: '成約率を数えるのに使います', action: '決める' },
  },
  content: {
    key: 'content', short: 'メッセージの見本', title: 'よく使うメッセージの見本を入れますか？', description: '予約の確認・前日のお知らせ・来店のお礼など、業種に合った見本をテンプレートに入れます。',
    choices: yesNo(
      { icon: 'file', label: '入れる', note: '「【見本】」の名前で入ります。直して使えます' },
      { icon: 'ban', label: '入れない', note: 'テンプレートとリッチメニューの見本は入れません' },
    ),
    where: 'テンプレート', manualHref: '/templates', manualNote: 'テンプレートの画面を開きます',
    todo: { title: 'メッセージの見本を決める', note: 'よく使うメッセージの見本です', action: '決める' },
  },
}

const PENDING: Record<string, Question> = {
  cancelDeadline: {
    key: 'cancelDeadline', short: 'キャンセルの期限', title: 'お客さまはいつまでキャンセルできますか？', description: 'LINE からキャンセルできる期限です。過ぎたらお店へ連絡してもらいます。',
    choices: [
      { value: 'day_before', icon: 'calendarCheck', label: '前日まで', note: '前日の 23:59 までキャンセルできます' },
      { value: 'hours_3', icon: 'clock', label: '3 時間前まで', note: '予約の 3 時間前までキャンセルできます' },
      { value: 'none', icon: 'ban', label: '期限なし', note: '予約の時間までいつでもキャンセルできます' },
    ],
    recommended: { consult: 'hours_3' },
    where: '予約設定 › 予約のルール', manualHref: RULES, manualNote: '予約のルールの画面を開きます',
    todo: { title: 'キャンセルの期限を決める', note: 'LINE からキャンセルできる期限です', action: '決める' },
  },
  seats: {
    key: 'seats', short: '席・卓', title: '席・卓はどう入れますか？', description: '予約を受ける席の数です。卓ごとの人数はあとで直せます。',
    choices: [
      { value: 'sample', icon: 'users', label: '見本の席を入れる（4 人卓 × 6）', note: 'あとで卓を足す・減らすことができます' },
      { value: 'none', icon: 'ban', label: '席を分けない', note: '時間ごとの組数だけで受け付けます' },
    ],
    where: '座席・卓管理', manualHref: '/restaurant-test/tables', manualNote: '座席・卓の画面を開きます',
    todo: { title: '席・卓を入れる', note: '予約を受ける席の数です', action: '入れる' },
  },
  nomination: {
    key: 'nomination', short: '担当者の指名', title: '担当者の指名を受け付けますか？', description: 'お客さまが予約のときに担当者を選べるようにします。',
    choices: [
      { value: 'allow', icon: 'user', label: '指名を受け付ける', note: '指名なしも選べます' },
      { value: 'none', icon: 'users', label: '指名は受け付けない', note: '空いている担当者に入ります' },
    ],
    where: '予約設定 › 担当者', manualHref: '/booking/menus?tab=staff', manualNote: '担当者の画面を開きます',
    todo: { title: '担当者の指名を決める', note: '予約のときに担当者を選べるかどうかです', action: '決める' },
  },
  assignment: {
    key: 'assignment', short: '担当の割り当て', title: '面談の担当はどう決めますか？', description: '予約が入ったときの担当の決め方です。',
    choices: [
      { value: 'auto', icon: 'users', label: '自動で割り当てる', note: '空いている担当に順番に入ります' },
      { value: 'customer', icon: 'user', label: 'お客さまが選ぶ', note: '担当を選んで予約してもらいます' },
    ],
    where: '予約設定 › 担当者', manualHref: '/booking/menus?tab=staff', manualNote: '担当者の画面を開きます',
    todo: { title: '担当の割り当てを決める', note: '予約が入ったときの担当の決め方です', action: '決める' },
  },
  classCapacity: {
    key: 'classCapacity', short: 'クラスの定員', title: '1 クラスの定員は？', description: '1 回のクラスで受け付ける人数です。',
    choices: [
      { value: '8', icon: 'users', label: '8 人', note: '少人数のクラスです' },
      { value: '20', icon: 'users', label: '20 人', note: '大人数のクラスです' },
    ],
    where: 'イベント予約', manualHref: '/events', manualNote: 'イベント予約の画面を開きます',
    todo: { title: 'クラスの定員を決める', note: '1 回のクラスで受け付ける人数です', action: '決める' },
  },
  hours: {
    key: 'hours', short: '営業時間', title: '予約を受け付ける時間は？', description: '予約を受け付ける曜日と時間です。休みの日はあとで足せます。',
    choices: [
      { value: 'day', icon: 'clock', label: '11:00〜22:00（毎日）', note: '昼と夜の両方で受け付けます' },
      { value: 'night', icon: 'clock', label: '17:00〜23:00（毎日）', note: '夜だけ受け付けます' },
    ],
    where: '予約設定 › 営業時間', manualHref: '/booking/menus?tab=hours', manualNote: '営業時間の画面を開きます',
    todo: { title: '営業時間を入れる', note: '予約を受け付ける曜日と時間です', action: '入れる' },
  },
  partySize: {
    key: 'partySize', short: '受け付ける人数', title: '1 回の予約で受け付ける人数は？', description: 'LINE から予約できる人数です。多い人数はお店へ連絡してもらいます。',
    choices: [
      { value: '1-6', icon: 'users', label: '1〜6 人', note: '7 人からはお店へ連絡してもらいます' },
      { value: '1-10', icon: 'users', label: '1〜10 人', note: '宴会も LINE で受け付けます' },
    ],
    where: '予約設定 › 予約のルール', manualHref: RULES, manualNote: '予約のルールの画面を開きます',
    todo: { title: '受け付ける人数を決める', note: 'LINE から予約できる人数です', action: '決める' },
  },
}
Object.assign(Q, PENDING)

/* B-313（オーナー）が正：飲食は 11 問（lS1Gh の左の一覧の並び）。予約を使うかは「予約の確定の仕方」の答えから送る。 */
const BY_STYLE: Record<AccountStyle, string[]> = {
  restaurant: ['approval', 'payment', 'cancelDeadline', 'reminders', 'stamps', 'coupons', 'seats', 'hours', 'partySize'],
  salon: ['approval', 'payment', 'cancelDeadline', 'reminders', 'tickets', 'stamps', 'coupons', 'nomination', 'hours'],
  consult: ['approval', 'payment', 'cancelDeadline', 'reminders', 'outcome', 'assignment', 'hours'],
  lesson: ['approval', 'payment', 'cancelDeadline', 'reminders', 'tickets', 'coupons', 'classCapacity', 'hours'],
  ec: ['coupons', 'content'],
  standard: ['content'],
}

/** 1問目（スタイル）と 2問目（見た目＝口の image）は形が違うので、名前だけを持つ。 */
export const STYLE_STEP = { key: 'style', short: '使い方のスタイル' } as const
export const LOOK_STEP = { key: 'image', short: '見た目' } as const

export const LOOK_CHOICES: ReadonlyArray<{ value: 'keep' | 'change' | 'existing' | 'configured' | 'later'; icon: IconKey; label: string; note: string }> = [
  { value: 'keep', icon: 'sparkles', label: '見本を使う（おすすめ）', note: 'の見本のまま使います。あとで画像だけ変えられます' },
  { value: 'change', icon: 'image', label: '画像を変える', note: '写真・ロゴを入れる／バナー生成で作る' },
  { value: 'existing', icon: 'folder', label: '同じアカウントの中にある物を使う', note: '今あるリッチメニュー・テンプレート・画像から選ぶ' },
  { value: 'configured', icon: 'download', label: 'もう設定した物を入れる', note: 'ほかのアカウントで作った物を入れる' },
  { value: 'later', icon: 'hourglass', label: 'あとで設定する', note: '今は入れません。はじめにやることに残ります' },
]

export function questionsFor(style: AccountStyle): Question[] {
  return BY_STYLE[style].map((key) => Q[key])
}

/** 左の一覧の並び（スタイル・見た目・質問…）。 */
export function stepNames(style: AccountStyle): Array<{ key: string; short: string }> {
  return [STYLE_STEP, LOOK_STEP, ...questionsFor(style).map(({ key, short }) => ({ key, short }))]
}

export function recommendedValue(question: Question, style: AccountStyle): string {
  return question.recommended?.[style] ?? question.choices[0].value
}

/** おすすめの答えの題に「（おすすめ）」を付ける。 */
export function choiceLabel(question: Question, choice: Choice, style: AccountStyle): string {
  return choice.value === recommendedValue(question, style) ? `${choice.label}（おすすめ）` : choice.label
}

/** 画面の値を口の答えへ（'true'/'false' は真偽）。 */
export function answerOf(value: string, question?: Question): SetupAnswer {
  if (value === 'later') return { mode: 'later' }
  if (value === 'manual') return { mode: 'manual' }
  const choice = question?.choices.find((item) => item.value === value)
  if (choice?.apiValue !== undefined) return { mode: 'configured', value: choice.apiValue }
  return { mode: 'configured', value: value === 'true' ? true : value === 'false' ? false : value }
}

/** 画面で選んでいる値（configured は value を文字にしたもの、ほかは mode）。 */
export function selectedValue(answer: SetupAnswer | undefined, question?: Question): string | null {
  if (!answer) return null
  const choice = answer.mode === 'configured' ? question?.choices.find((item) => item.apiValue !== undefined && item.apiValue === answer.value) : undefined
  if (choice) return choice.value
  return answer.mode === 'configured' ? String(answer.value ?? (answer.resourceId ? 'existing' : '')) : answer.mode
}

/* ── 開き直したときの保存（B-335 (2)） ─────────────────────────── */

/** 予約設定に書く答え（口は approval を予約設定の承認の仕方へ書く）。 */
export const SETTINGS_KEYS = ['approval']

const same = (a: SetupAnswer | undefined, b: SetupAnswer | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** 前に保存した答えから変わった物だけ。 */
export function changedAnswers(saved: Record<string, SetupAnswer>, next: Record<string, SetupAnswer>): Record<string, SetupAnswer> {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => !same(saved[key], value)))
}

const APPROVAL_WORD: Record<string, string> = { automatic: 'その場で確定する', manual: 'お店が承認してから確定する' }

/** 予約設定のどこがどう変わるか（確かめの窓の文）。変わらなければ空。 */
export function settingsChanges(saved: Record<string, SetupAnswer>, next: Record<string, SetupAnswer>): string[] {
  const changed = changedAnswers(saved, next)
  const lines: string[] = []
  const approval = changed.approval
  if (approval?.mode === 'configured') {
    const before = saved.approval?.mode === 'configured' ? APPROVAL_WORD[String(saved.approval.value)] : null
    lines.push(`予約の確定の仕方：${before ? `${before} → ` : ''}${APPROVAL_WORD[String(approval.value)] ?? String(approval.value)}`)
  }
  return lines
}

/** 予約確定のご案内の見本（いつもの確定の知らせと重なる。B-335 (3)・点検 1-3）。 */
export function isBookingConfirmSample(item: StarterSetItem): boolean {
  return item.kind === 'automation' && (item.key === 'reminder' || item.name.includes('予約確定'))
}

/* ── 機能と、リッチメニューのボタンの決まり（警告・お客さまの見え方） ─────────── */

/** 機能（口の feature）。settingHref は今ある設定の画面。preparing は設定の画面がまだ無い物（準備中の窓）。 */
export const FEATURES: Record<string, { name: string; opens: string; settingHref: string; preparing?: string }> = {
  booking: { name: '予約', opens: '予約のページを開く', settingHref: '/booking/menus' },
  history: { name: '予約の確認', opens: '予約の履歴を開く', settingHref: '/booking/menus' },
  coupons: { name: 'クーポン', opens: 'クーポンの一覧を開く', settingHref: '/templates', preparing: 'クーポン' },
  menu: { name: 'メニュー', opens: 'メニューのページを開く', settingHref: '/restaurant-test/menu' },
  stamps: { name: '来店スタンプ', opens: '来店スタンプを開く', settingHref: '/visit-stamps' },
  tickets: { name: '回数券', opens: '回数券を開く', settingHref: '/booking/menus', preparing: '回数券' },
  contact: { name: 'お問い合わせ', opens: 'トークを開く', settingHref: '/chats' },
  photos: { name: 'スタイル写真', opens: '写真のページを開く', settingHref: '/rich-menus' },
  faq: { name: 'よくある質問', opens: 'よくある質問を開く', settingHref: '/auto-replies' },
  docs: { name: '資料', opens: '資料のページを開く', settingHref: '/rich-menus' },
  about: { name: '会社のこと', opens: '会社のページを開く', settingHref: '/rich-menus' },
  transfer: { name: '振替', opens: '振替のページを開く', settingHref: '/events' },
  schedule: { name: 'スケジュール', opens: 'スケジュールを開く', settingHref: '/events' },
}

export function featureName(feature: string): string {
  return FEATURES[feature]?.name ?? feature
}

/** 機能の設定の画面。口の href は今の画面に無い道（/booking/settings 等）があるので、画面の表を先に使う。 */
export function featureHref(feature: string, fallback?: string): string {
  return FEATURES[feature]?.settingHref ?? fallback ?? '/'
}

/* ── 見本のリッチメニュー（wI4ZX）。色は見本の画像の色（globals.css の --sample-*） ───────────── */

export type SampleTile = { label: string; icon: string; feature: string }
export type SampleMenu = { account: string; greeting: string; tone: { bg: string; ink: string }; tiles: SampleTile[] }

export const SAMPLE_MENUS: Partial<Record<AccountStyle, SampleMenu>> = {
  restaurant: {
    account: '然 - 和食 -', greeting: '友だち追加ありがとうございます。ご予約・クーポンは下のメニューからどうぞ。', tone: { bg: 'var(--sample-restaurant-bg)', ink: 'var(--sample-restaurant-ink)' },
    tiles: [
      { label: '予約する', icon: 'calendarCheck', feature: 'booking' }, { label: '予約の確認', icon: 'list', feature: 'history' }, { label: 'クーポン', icon: 'ticket', feature: 'coupons' },
      { label: 'メニュー', icon: 'book', feature: 'menu' }, { label: 'スタンプ', icon: 'stamp', feature: 'stamps' }, { label: 'お問い合わせ', icon: 'message', feature: 'contact' },
    ],
  },
  salon: {
    account: 'Hair Salon 然', greeting: '友だち追加ありがとうございます。ご予約・回数券の残りは下のメニューから見られます。', tone: { bg: 'var(--sample-salon-bg)', ink: 'var(--sample-salon-ink)' },
    tiles: [
      { label: '予約', icon: 'calendarCheck', feature: 'booking' }, { label: '予約の確認', icon: 'list', feature: 'history' }, { label: '回数券', icon: 'ticket', feature: 'tickets' },
      { label: 'スタイル写真', icon: 'image', feature: 'photos' }, { label: 'スタンプ', icon: 'stamp', feature: 'stamps' }, { label: 'お問い合わせ', icon: 'message', feature: 'contact' },
    ],
  },
  consult: {
    account: '然 相談窓口', greeting: '友だち追加ありがとうございます。面談のご予約・資料は下のメニューからどうぞ。', tone: { bg: 'var(--sample-consult-bg)', ink: 'var(--sample-consult-ink)' },
    tiles: [
      { label: '面談を予約', icon: 'calendarCheck', feature: 'booking' }, { label: '予約の確認', icon: 'list', feature: 'history' }, { label: '資料', icon: 'file', feature: 'docs' },
      { label: 'よくある質問', icon: 'bulb', feature: 'faq' }, { label: 'お問い合わせ', icon: 'message', feature: 'contact' }, { label: '会社のこと', icon: 'building', feature: 'about' },
    ],
  },
  lesson: {
    account: '然 ヨガスタジオ', greeting: '友だち追加ありがとうございます。クラスの予約・振替は下のメニューからどうぞ。', tone: { bg: 'var(--sample-lesson-bg)', ink: 'var(--sample-lesson-ink)' },
    tiles: [
      { label: 'クラスを予約', icon: 'calendarCheck', feature: 'booking' }, { label: '予約の確認', icon: 'list', feature: 'history' }, { label: '回数券と月謝', icon: 'ticket', feature: 'tickets' },
      { label: '振替', icon: 'repeat', feature: 'transfer' }, { label: 'スケジュール', icon: 'calendarDays', feature: 'schedule' }, { label: 'お問い合わせ', icon: 'message', feature: 'contact' },
    ],
  },
}

export const SAMPLE_STYLES: AccountStyle[] = ['restaurant', 'salon', 'consult', 'lesson']

export function sampleMenuFor(style: AccountStyle): SampleMenu {
  return SAMPLE_MENUS[style] ?? SAMPLE_MENUS.restaurant!
}

/* ── 入った物（starter-items）と初期セットの中身（definition）の突き合わせ ────────── */

export type StarterItemState = { target_id: string; kind: string; is_sample: number; status: string | null; draftRevision: string | null }

/**
 * 口の starter-items は item_key を返さない（API-CONTRACT-4 §10）。種類ごとに、初期セットの中身の並びと
 * 入った物の並びを前から対応させて名前を付ける。入った物より中身が多い（未定で入れなかった）ときは名前だけ余る。
 */
export function pairStarterItems(definition: StarterSetItem[], items: StarterItemState[]): Array<{ item: StarterSetItem; state: StarterItemState }> {
  const out: Array<{ item: StarterSetItem; state: StarterItemState }> = []
  for (const kind of [...new Set(items.map((state) => state.kind))]) {
    const defs = definition.filter((item) => item.kind === kind)
    items.filter((state) => state.kind === kind).forEach((state, index) => {
      out.push({ item: defs[index] ?? { key: state.target_id, kind: kind as StarterSetItem['kind'], name: kind }, state })
    })
  }
  return out
}

/** 動かす前に確かめる物（オートメーションの下書き・止めた予約メニュー）。 */
export function needsActivation(state: StarterItemState): boolean {
  /* 予約確定の見本は名前で判定するので、一覧側（isBookingConfirmSample）で外す。 */
  return (state.kind === 'automation' || state.kind === 'booking_menu') && state.status !== 'active'
}

/* ── はじめにやること（Bdfxm） ─────────────────────────────────── */

export type StyleState = { style: AccountStyle; styleSelected: boolean; styleMode?: SetupAnswer['mode']; version: number; answers: Record<string, SetupAnswer> }
export type StyleWarning = { feature: string; areaId: string; groupId: string; href?: string; customerState: 'preparing' }

export type TodoRow = {
  key: string
  title: string
  note: string
  badge: { tone: 'warning' | 'neutral'; label: string }
  alert?: boolean
  action: { label: string; href?: string; step?: string; preparing?: string }
}

export type SetupSummary = {
  style: AccountStyle
  done: number
  total: number
  doneNames: string[]
  rows: TodoRow[]
  nextStep: number
}

/** 答え・警告・止めている自動の送信から、はじめにやることの行を組む。 */
export function summarizeSetup(state: StyleState, warnings: StyleWarning[], items: StarterItemState[]): SetupSummary {
  const steps = stepNames(state.style)
  const questions = questionsFor(state.style)
  const answers = state.answers ?? {}
  const doneKeys = steps.filter((step) => step.key === 'style' ? state.styleSelected : answers[step.key]?.mode === 'configured').map((step) => step.key)
  const rows: TodoRow[] = []
  const warned = new Set<string>()
  for (const warning of warnings) {
    if (warned.has(warning.feature)) continue
    warned.add(warning.feature)
    const preparing = FEATURES[warning.feature]?.preparing
    rows.push({
      key: `warning-${warning.feature}`,
      title: `${featureName(warning.feature)}の決まりを入れる`,
      note: 'リッチメニューにボタンがあるのに中身が未設定です',
      badge: { tone: 'warning', label: '未設定' },
      alert: true,
      action: preparing ? { label: '決まりを入れる', preparing } : { label: '決まりを入れる', href: featureHref(warning.feature, warning.href) },
    })
  }
  if (!state.styleSelected && state.styleMode !== 'manual') rows.push({ key: 'style', title: '使い方のスタイルを選ぶ', note: '答えに合わせて、メニュー・見本・設定をまとめて入れます', badge: { tone: 'neutral', label: 'あとで' }, action: { label: '選ぶ', step: 'style' } })
  for (const question of questions) {
    const answer = answers[question.key]
    if (!answer || answer.mode === 'configured') continue
    if (warned.has(question.key)) continue
    rows.push({
      key: question.key,
      title: question.todo.title,
      note: question.todo.note,
      badge: { tone: 'neutral', label: answer.mode === 'manual' ? '手動' : 'あとで' },
      action: question.preparing ? { label: question.todo.action, preparing: question.preparing } : { label: question.todo.action, href: question.manualHref },
    })
  }
  if (items.some(needsActivation)) {
    rows.push({ key: 'activation', title: '入った予約メニュー・お知らせを動かす', note: '止めた状態で入っています', badge: { tone: 'neutral', label: '止めている' }, action: { label: '中身を見る', step: 'summary' } })
  }
  const look = answers.image
  if (look?.mode === 'configured' && (look.value === 'keep' || look.value === 'change')) {
    rows.push({ key: 'images', title: 'お店の写真とロゴを入れる', note: '見本の画像のままです', badge: { tone: 'neutral', label: 'あとで' }, action: { label: '画像を変える', href: '/rich-menus' } })
  } else if (look && look.mode !== 'configured') {
    rows.push({ key: 'image', title: 'リッチメニューなどの見た目を決める', note: '見本を使うか、画像を変えるかを選びます', badge: { tone: 'neutral', label: 'あとで' }, action: { label: '決める', step: 'image' } })
  }
  const firstOpen = steps.findIndex((step) => !doneKeys.includes(step.key))
  return {
    style: state.style,
    done: doneKeys.length,
    total: steps.length,
    doneNames: steps.filter((step) => doneKeys.includes(step.key)).map((step) => step.short),
    rows,
    nextStep: firstOpen < 0 ? steps.length : firstOpen,
  }
}
