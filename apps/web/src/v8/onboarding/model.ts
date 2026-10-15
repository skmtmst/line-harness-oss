import type { AccountStyle, SetupAnswer, StarterItemState, StyleState, StyleWarning } from '@/lib/api-style-setup'
import { PREPARING_WORD } from '@/components/shared/preparing-dialog'

/*
 * はじめの質問（B-313）と初期セット（B-311）の決まりを画面から切り離した表。
 * 絵：修正案 DIHFx の列 VHp7p（xxpM9・RZW83・lS1Gh・rJ36f・oKSsG・Bdfxm）。
 *
 * - 質問はスタイルごとに並ぶ（飲食店向けは 11 問。絵 lS1Gh の左の一覧）。
 * - どの質問にも「あとで設定する」「手動で設定する」がある（B-313 追記）。あとで＝何も入れない・
 *   はじめにやることに残る。手動＝その設定の画面へ案内する。
 * - おすすめの答えは業種ごとに先に選んでおく（飛ばしても困らない）。
 * - どの質問にも「あとから変えられます（どこで）」を出す。
 */

export type IconKey =
  | 'utensils' | 'scissors' | 'messages' | 'graduation' | 'bag' | 'grid'
  | 'sparkles' | 'image' | 'folder' | 'download' | 'hourglass' | 'settings'
  | 'circleCheck' | 'userCheck' | 'store' | 'card' | 'split' | 'calendarX' | 'clock' | 'bell' | 'bellOff'
  | 'stamp' | 'ticket' | 'ban' | 'armchair' | 'users' | 'user'

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

/** 1問の選択肢。value は保存する答え。 */
export type Choice = { value: string; icon: IconKey; label: string; note: string }

export type Question = {
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
  /** 設定の画面がまだ無い（口が無い）ときの機能の名前。押すと準備中の窓（B-314）。 */
  preparing?: string
}

const RULES = '/booking/menus?tab=rules'

const COMMON_HEAD: Question[] = [
  {
    key: 'confirmation', short: '予約の確定の仕方', title: '予約はその場で確定しますか？', description: 'お客さまが LINE で予約したときの扱いです。',
    choices: [
      { value: 'instant', icon: 'circleCheck', label: 'その場で確定する', note: '空いていれば、すぐに予約が決まります。' },
      { value: 'approval', icon: 'userCheck', label: 'お店が承認してから確定する', note: '届いた予約を見て、お店が［承認する］を押すと決まります' },
    ],
    recommended: { restaurant: 'instant', salon: 'instant', consult: 'approval', lesson: 'instant' },
    where: '予約設定 › 予約のルール', manualHref: RULES, manualNote: '予約のルールの画面を開きます',
    todo: { title: '予約の確定の仕方を決める', note: 'その場で確定するか、お店が承認するかを選びます', action: '決める' },
  },
  {
    key: 'payment', short: 'お支払い', title: '予約のときのお支払いはどうしますか？', description: 'コース・メニューごとにあとで変えられます。',
    choices: [
      { value: 'store', icon: 'store', label: 'お店で払う', note: '来店したときにお店で払います。今までどおりです' },
      { value: 'online', icon: 'card', label: 'オンラインで先払い', note: '予約のときにカードで払います。Stripe をつなぐと使えます' },
      { value: 'customer_choice', icon: 'split', label: 'お客さまが選ぶ', note: '先払いか、お店で払うかをお客さまが選びます' },
    ],
    where: '予約設定 › お支払い', manualHref: '/booking/menus?tab=payment', manualNote: 'お支払いの画面を開きます',
    info: 'オンラインを選ぶと、最後に Stripe をつなぐ案内が出ます。つなぐまでは試験モードで、本当の請求は起きません。',
    todo: { title: 'Stripe をつなぐ', note: 'オンライン先払いを使うときに必要です', action: 'つなぐ' },
    skipped: 'Stripe をつなぐまで、お店で払うだけです',
    preparing: 'お支払い',
  },
  {
    key: 'cancelDeadline', short: 'キャンセルの期限', title: 'お客さまはいつまでキャンセルできますか？', description: 'LINE からキャンセルできる期限です。過ぎたらお店へ連絡してもらいます。',
    choices: [
      { value: 'day_before', icon: 'calendarX', label: '前日まで', note: '前日の 23:59 までキャンセルできます' },
      { value: 'hours_3', icon: 'clock', label: '3 時間前まで', note: '予約の 3 時間前までキャンセルできます' },
      { value: 'none', icon: 'ban', label: '期限なし', note: '予約の時間までいつでもキャンセルできます' },
    ],
    recommended: { restaurant: 'day_before', salon: 'day_before', consult: 'hours_3', lesson: 'day_before' },
    where: '予約設定 › 予約のルール', manualHref: RULES, manualNote: '予約のルールの画面を開きます',
    todo: { title: 'キャンセルの期限を決める', note: 'LINE からキャンセルできる期限です', action: '決める' },
  },
  {
    key: 'reminder', short: '前日のお知らせ', title: '予約の前日にお知らせを送りますか？', description: 'LINE で自動で送ります。最初は止めた状態で入り、最後に確かめてから動かします。',
    choices: [
      { value: 'on', icon: 'bell', label: '前日の 18:00 に送る', note: '予約の日時・場所・キャンセルの方法を送ります' },
      { value: 'off', icon: 'bellOff', label: '送らない', note: 'お知らせは入れません' },
    ],
    where: 'リマインダ', manualHref: '/reminders', manualNote: 'リマインダの画面を開きます',
    todo: { title: '前日のお知らせを決める', note: '予約の前日に LINE で送るお知らせです', action: '決める' },
  },
]

const STAMP: Question = {
  key: 'visitStamp', short: '来店スタンプ', title: '来店スタンプを使いますか？', description: '来店ごとにスタンプを押し、たまったら特典を渡します。',
  choices: [
    { value: 'use', icon: 'stamp', label: '使う（10 個で特典）', note: '10 個たまったら特典を渡す見本で入れます' },
    { value: 'no', icon: 'ban', label: '使わない', note: 'リッチメニューの「スタンプ」も外します' },
  ],
  where: '来店スタンプ', manualHref: '/visit-stamps', manualNote: '来店スタンプの画面を開きます',
  todo: { title: '来店スタンプの決まりを入れる', note: 'リッチメニューにボタンがあるのに中身が未設定です', action: '決まりを入れる' },
  skipped: `リッチメニューの「スタンプ」は、お客さまには「${PREPARING_WORD}」と出ます`,
}

const COUPON: Question = {
  key: 'coupon', short: 'クーポン', title: 'はじめてのお客さまにクーポンを出しますか？', description: '友だち追加のあとに届けます。リッチメニューの「クーポン」からも開けます。',
  choices: [
    { value: 'first', icon: 'ticket', label: 'はじめての方 10% オフ', note: '見本のクーポンを入れます。中身はあとで変えられます' },
    { value: 'no', icon: 'ban', label: '出さない', note: 'クーポンは入れません' },
  ],
  where: '配信 › 友だち追加時の配信', manualHref: '/friend-add-settings', manualNote: '友だち追加時の配信の画面を開きます',
  todo: { title: 'クーポンを決める', note: 'はじめてのお客さまに届けるクーポンです', action: '決める' },
}

const HOURS: Question = {
  key: 'hours', short: '営業時間', title: '予約を受け付ける時間は？', description: '予約を受け付ける曜日と時間です。休みの日はあとで足せます。',
  choices: [
    { value: 'day', icon: 'clock', label: '11:00〜22:00（毎日）', note: '昼と夜の両方で受け付けます' },
    { value: 'night', icon: 'clock', label: '17:00〜23:00（毎日）', note: '夜だけ受け付けます' },
  ],
  recommended: { salon: 'day', consult: 'day', lesson: 'day', restaurant: 'day' },
  where: '予約設定 › 営業時間', manualHref: '/booking/menus?tab=hours', manualNote: '営業時間の画面を開きます',
  todo: { title: '営業時間を入れる', note: '予約を受け付ける曜日と時間です', action: '入れる' },
}

const PEOPLE: Question = {
  key: 'partySize', short: '受け付ける人数', title: '1 回の予約で受け付ける人数は？', description: 'LINE から予約できる人数です。多い人数はお店へ連絡してもらいます。',
  choices: [
    { value: '1-6', icon: 'users', label: '1〜6 人', note: '7 人からはお店へ連絡してもらいます' },
    { value: '1-10', icon: 'users', label: '1〜10 人', note: '宴会も LINE で受け付けます' },
  ],
  where: '予約設定 › 予約のルール', manualHref: RULES, manualNote: '予約のルールの画面を開きます',
  todo: { title: '受け付ける人数を決める', note: 'LINE から予約できる人数です', action: '決める' },
}

const BY_STYLE: Partial<Record<AccountStyle, Question>> = {
  restaurant: {
    key: 'seats', short: '席・卓', title: '席・卓はどう入れますか？', description: '予約を受ける席の数です。卓ごとの人数はあとで直せます。',
    choices: [
      { value: 'sample', icon: 'armchair', label: '見本の席を入れる（4 人卓 × 6）', note: 'あとで卓を足す・減らすことができます' },
      { value: 'none', icon: 'ban', label: '席を分けない', note: '時間ごとの組数だけで受け付けます' },
    ],
    where: '座席・卓管理', manualHref: '/restaurant-test/tables', manualNote: '座席・卓の画面を開きます',
    todo: { title: '席・卓を入れる', note: '予約を受ける席の数です', action: '入れる' },
  },
  salon: {
    key: 'nomination', short: '担当者の指名', title: '担当者の指名を受け付けますか？', description: 'お客さまが予約のときに担当者を選べるようにします。',
    choices: [
      { value: 'allow', icon: 'user', label: '指名を受け付ける', note: '指名なしも選べます' },
      { value: 'none', icon: 'users', label: '指名は受け付けない', note: '空いている担当者に入ります' },
    ],
    where: '予約設定 › 担当者', manualHref: '/booking/menus?tab=staff', manualNote: '担当者の画面を開きます',
    todo: { title: '担当者の指名を決める', note: '予約のときに担当者を選べるかどうかです', action: '決める' },
  },
  consult: {
    key: 'assignment', short: '担当の割り当て', title: '面談の担当はどう決めますか？', description: '予約が入ったときの担当の決め方です。',
    choices: [
      { value: 'auto', icon: 'users', label: '自動で割り当てる', note: '空いている担当に順番に入ります' },
      { value: 'customer', icon: 'user', label: 'お客さまが選ぶ', note: '担当を選んで予約してもらいます' },
    ],
    where: '予約設定 › 担当者', manualHref: '/booking/menus?tab=staff', manualNote: '担当者の画面を開きます',
    todo: { title: '担当の割り当てを決める', note: '予約が入ったときの担当の決め方です', action: '決める' },
  },
  lesson: {
    key: 'classCapacity', short: 'クラスの定員', title: '1 クラスの定員は？', description: '1 回のクラスで受け付ける人数です。',
    choices: [
      { value: '8', icon: 'users', label: '8 人', note: '少人数のクラスです' },
      { value: '20', icon: 'users', label: '20 人', note: '大人数のクラスです' },
    ],
    where: 'イベント予約', manualHref: '/events', manualNote: 'イベント予約の画面を開きます',
    todo: { title: 'クラスの定員を決める', note: '1 回のクラスで受け付ける人数です', action: '決める' },
  },
}

/** 1問目（スタイル）と 2問目（見た目）は形が違うので、名前と行き先だけを持つ。 */
export const STYLE_STEP = { key: 'style', short: '使い方のスタイル' } as const
export const LOOK_STEP = { key: 'look', short: '見た目' } as const

export const LOOK_CHOICES: ReadonlyArray<{ value: 'sample' | 'image' | 'existing' | 'configured' | 'later'; icon: IconKey; label: string; note: string }> = [
  { value: 'sample', icon: 'sparkles', label: '見本を使う（おすすめ）', note: 'の見本のまま使います。あとで画像だけ変えられます' },
  { value: 'image', icon: 'image', label: '画像を変える', note: '写真・ロゴを入れる／バナー生成で作る' },
  { value: 'existing', icon: 'folder', label: '同じアカウントの中にある物を使う', note: '今あるリッチメニュー・テンプレート・画像から選ぶ' },
  { value: 'configured', icon: 'download', label: 'もう設定した物を入れる', note: 'ほかのアカウントで作った物を入れる' },
  { value: 'later', icon: 'hourglass', label: 'あとで設定する', note: '今は入れません。はじめにやることに残ります' },
]

/** スタイルごとの質問（1問目・2問目を除く）。EC・標準は予約の質問を出さない。 */
export function questionsFor(style: AccountStyle): Question[] {
  if (style === 'ec' || style === 'standard') return [COUPON]
  const special = BY_STYLE[style]
  return [...COMMON_HEAD, STAMP, COUPON, ...(special ? [special] : []), HOURS, PEOPLE]
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

/** 答えの形。見た目の「見本・画像・流用・設定済み」は configured に value を付けて持つ。 */
export function answerOf(value: string): SetupAnswer {
  if (value === 'later') return { mode: 'later' }
  if (value === 'manual') return { mode: 'manual' }
  return { mode: 'configured', value }
}

/** 画面で選んでいる値（configured は value、ほかは mode）。 */
export function selectedValue(answer: SetupAnswer | undefined): string | null {
  if (!answer) return null
  return answer.mode === 'configured' ? String(answer.value ?? '') : answer.mode
}

/* ── 機能と、リッチメニューのボタンの決まり（警告・お客さまの見え方） ─────────── */

export const FEATURES: Record<string, { name: string; opens: string; settingHref: string }> = {
  reserve: { name: '予約', opens: '予約のページを開く', settingHref: '/booking/menus' },
  history: { name: '予約の確認', opens: '予約の履歴を開く', settingHref: '/booking/menus' },
  coupon: { name: 'クーポン', opens: 'クーポンの一覧を開く', settingHref: '/friend-add-settings' },
  menu: { name: 'メニュー', opens: 'メニューのページを開く', settingHref: '/restaurant-test/menu' },
  visit_stamp: { name: '来店スタンプ', opens: '来店スタンプを開く', settingHref: '/visit-stamps' },
  ticket: { name: '回数券', opens: '回数券を開く', settingHref: '/booking/menus' },
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

/* ── 見本のリッチメニュー（wI4ZX）。色は見本の画像の色（globals.css の --sample-*） ───────────── */

export type SampleTile = { label: string; icon: string; feature: string }
export type SampleMenu = { account: string; greeting: string; tone: { bg: string; ink: string }; tiles: SampleTile[] }

export const SAMPLE_MENUS: Partial<Record<AccountStyle, SampleMenu>> = {
  restaurant: {
    account: '然 - 和食 -', greeting: '友だち追加ありがとうございます。ご予約・クーポンは下のメニューからどうぞ。', tone: { bg: 'var(--sample-restaurant-bg)', ink: 'var(--sample-restaurant-ink)' },
    tiles: [
      { label: '予約する', icon: 'calendarCheck', feature: 'reserve' }, { label: '予約の確認', icon: 'list', feature: 'history' }, { label: 'クーポン', icon: 'ticket', feature: 'coupon' },
      { label: 'メニュー', icon: 'book', feature: 'menu' }, { label: 'スタンプ', icon: 'stamp', feature: 'visit_stamp' }, { label: 'お問い合わせ', icon: 'message', feature: 'contact' },
    ],
  },
  salon: {
    account: 'Hair Salon 然', greeting: '友だち追加ありがとうございます。ご予約・回数券の残りは下のメニューから見られます。', tone: { bg: 'var(--sample-salon-bg)', ink: 'var(--sample-salon-ink)' },
    tiles: [
      { label: '予約', icon: 'calendarCheck', feature: 'reserve' }, { label: '予約の確認', icon: 'list', feature: 'history' }, { label: '回数券', icon: 'ticket', feature: 'ticket' },
      { label: 'スタイル写真', icon: 'image', feature: 'photos' }, { label: 'スタンプ', icon: 'stamp', feature: 'visit_stamp' }, { label: 'お問い合わせ', icon: 'message', feature: 'contact' },
    ],
  },
  consult: {
    account: '然 相談窓口', greeting: '友だち追加ありがとうございます。面談のご予約・資料は下のメニューからどうぞ。', tone: { bg: 'var(--sample-consult-bg)', ink: 'var(--sample-consult-ink)' },
    tiles: [
      { label: '面談を予約', icon: 'calendarCheck', feature: 'reserve' }, { label: '予約の確認', icon: 'list', feature: 'history' }, { label: '資料', icon: 'file', feature: 'docs' },
      { label: 'よくある質問', icon: 'bulb', feature: 'faq' }, { label: 'お問い合わせ', icon: 'message', feature: 'contact' }, { label: '会社のこと', icon: 'building', feature: 'about' },
    ],
  },
  lesson: {
    account: '然 ヨガスタジオ', greeting: '友だち追加ありがとうございます。クラスの予約・振替は下のメニューからどうぞ。', tone: { bg: 'var(--sample-lesson-bg)', ink: 'var(--sample-lesson-ink)' },
    tiles: [
      { label: 'クラスを予約', icon: 'calendarCheck', feature: 'reserve' }, { label: '予約の確認', icon: 'list', feature: 'history' }, { label: '回数券と月謝', icon: 'ticket', feature: 'ticket' },
      { label: '振替', icon: 'repeat', feature: 'transfer' }, { label: 'スケジュール', icon: 'calendarDays', feature: 'schedule' }, { label: 'お問い合わせ', icon: 'message', feature: 'contact' },
    ],
  },
}

export const SAMPLE_STYLES: AccountStyle[] = ['restaurant', 'salon', 'consult', 'lesson']

export function sampleMenuFor(style: AccountStyle): SampleMenu {
  return SAMPLE_MENUS[style] ?? SAMPLE_MENUS.restaurant!
}

/* ── はじめにやること（Bdfxm） ─────────────────────────────────── */

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
    rows.push({
      key: `warning-${warning.feature}`,
      title: `${featureName(warning.feature)}の決まりを入れる`,
      note: 'リッチメニューにボタンがあるのに中身が未設定です',
      badge: { tone: 'warning', label: '未設定' },
      alert: true,
      action: { label: '決まりを入れる', href: warning.href },
    })
  }
  if (!state.styleSelected) rows.push({ key: 'style', title: '使い方のスタイルを選ぶ', note: '答えに合わせて、メニュー・見本・設定をまとめて入れます', badge: { tone: 'neutral', label: 'あとで' }, action: { label: '選ぶ', step: 'style' } })
  for (const question of questions) {
    const answer = answers[question.key]
    if (!answer || answer.mode === 'configured') continue
    if (question.key === 'visitStamp' && warned.has('visit_stamp')) continue
    rows.push({
      key: question.key,
      title: question.todo.title,
      note: question.todo.note,
      badge: { tone: 'neutral', label: answer.mode === 'manual' ? '手動' : 'あとで' },
      action: question.preparing ? { label: question.todo.action, preparing: question.preparing } : { label: question.todo.action, href: question.manualHref },
    })
  }
  const stopped = items.filter((item) => item.kind === 'automation' && item.status !== 'active')
  if (stopped.length > 0) {
    rows.push({ key: 'automations', title: '前日・当日のお知らせを動かす', note: '止めた状態で入っています', badge: { tone: 'neutral', label: '止めている' }, action: { label: '中身を見る', step: 'summary' } })
  }
  const look = answers.look
  if (look?.mode === 'configured' && look.value === 'sample') {
    rows.push({ key: 'images', title: 'お店の写真とロゴを入れる', note: '見本の画像のままです', badge: { tone: 'neutral', label: 'あとで' }, action: { label: '画像を変える', step: 'look' } })
  } else if (look && look.mode !== 'configured') {
    rows.push({ key: 'look', title: 'リッチメニューなどの見た目を決める', note: '見本を使うか、画像を変えるかを選びます', badge: { tone: 'neutral', label: 'あとで' }, action: { label: '決める', step: 'look' } })
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
