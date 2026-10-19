import { describe, expect, it } from 'vitest'
import type { LineAccountConnectData } from '@/lib/api'
import {
  DRAFT_KEY, LOGIN_ACKS, PRECHECK_RESULT, PRECHECK_VERIFIED_ACK, WEBHOOK_ACKS, allAcked, allV06RowsOk,
  allV8RowsPassed, checkActionLabel, checkErrorText, checkRowText, checkStage, developerChannelUrl,
  formatJaDuration, handoverProgress, loginChannelErrors, messagingApiErrors, nextCursor, precheckAsked,
  precheckBack, precheckBlocked, precheckNext, precheckNote, precheckStateLabel, precheckSummary, precheckUpcoming,
  readDraft, readPrecheckAnswers, readPrecheckAt, stepLabel, subTotal, templateOptions, toV06CheckRows, toV8CheckRows,
} from './logic'
import type { V06CheckRow } from './logic'

const storage = (value: unknown) => ({ getItem: (key: string) => key === DRAFT_KEY ? JSON.stringify(value) : null })
const connection = (webhook: 'passed' | 'failed'): LineAccountConnectData => ({
  steps: [1, 2, 3, 4, 5].map((order) => ({ order: order as 1, message: `段${order}`, state: order === 3 ? webhook : 'passed' })),
  verification: { tokenOk: true, loginOk: true, sameProvider: true, webhook: { expectedUrl: 'https://x/webhook', registeredUrl: 'https://x/webhook', active: webhook === 'passed', testPassed: webhook === 'passed' }, followerTotal: 3 },
  pictureUrl: null, basicId: '@nen', followerImport: { capability: 'available', phase: 'not_started' }, remainingActions: [],
})

describe('LINEアカウントを登録（★V8）の小さな計算', () => {
  it('手順1のまま何も入れていない下書きは戻さない（開き直しただけで「下書きから続けます」を出さない）', () => {
    expect(readDraft(storage({ step: 1, accountMethod: 'existing', name: '', channelId: '', loginChannelId: '', lineId: '', tagIds: [], parentId: '', staffIds: [], liffId: '', importFriends: true }))).toBeNull()
  })

  it('中身のある下書きは戻す（秘密値の欄は持たない）', () => {
    const draft = readDraft(storage({ step: 2, accountMethod: 'existing', name: '', channelId: '2001', channelSecret: 'secret', loginChannelId: '', lineId: '', tagIds: [], parentId: '', staffIds: [], liffId: '', importFriends: true }))
    expect(draft).toMatchObject({ step: 2, channelId: '2001' })
    expect(draft && 'channelSecret' in draft).toBe(false)
    // ①の答えだけでも「中身のある下書き」。何も答えていなければ手順1は戻さない。
    expect(readDraft(storage({ step: 1, precheck: { q1: 'yes' }, precheckAt: 'q2' }))).toMatchObject({ step: 1, precheckAt: 'q2', precheck: { q1: 'yes' } })
    expect(readDraft(storage({ step: 1, accountMethod: 'new' }))).toBeNull()
  })

  it('④の5行：検査前はすべて「まだ」、Webhook が止まれば4・5行目は「まだ」のまま、全部通れば保存できる', () => {
    expect(toV8CheckRows(null).map((row) => row.state)).toEqual(['todo', 'todo', 'todo', 'todo', 'todo'])
    const stopped = toV8CheckRows(connection('failed'))
    expect(stopped.map((row) => row.state)).toEqual(['passed', 'passed', 'failed', 'todo', 'todo'])
    expect(stopped[2].detail).toContain('「Webhook の利用」がオフです')
    expect(allV8RowsPassed(stopped)).toBe(false)
    const passed = toV8CheckRows(connection('passed'))
    expect(allV8RowsPassed(passed)).toBe(true)
    // lin.ee は LINE が発行する短縮URLで basicId から作れない。開ける標準形を出す。
    expect(passed[4].detail).toBe('https://line.me/R/ti/p/@nen')
  })

  it('④の止まった行は理由を1つだけ出す（Webhook のオフの説明に段の文を重ねない）', () => {
    const stopped = toV8CheckRows(connection('failed'))
    expect(checkRowText(stopped[2])).toBe('LINE Developers で「Webhook の利用」がオフです。オンにしてから押し直してください')
    expect(checkRowText(stopped[2])).not.toContain('段3')
    const noDetail = toV8CheckRows({ ...connection('failed'), verification: undefined })
    expect(checkRowText(noDetail[2])).toBe('受け口へ届きませんでした（段3）')
    expect(checkRowText(stopped[0])).toBe('Messaging API・LINE Login とも認証済み')
  })
})

describe('①事前確認（v07 p6zMkA）の出しわけ', () => {
  it('Q3はQ2=はいのときだけ、Q5はQ4=はいのときだけ尋ねる', () => {
    expect(precheckAsked('q1', {})).toBe(true)
    expect(precheckAsked('q2', {})).toBe(true)
    expect(precheckAsked('q4', {})).toBe(true)
    expect(precheckAsked('q3', {})).toBe(false)
    expect(precheckAsked('q3', { q2: 'no' })).toBe(false)
    expect(precheckAsked('q3', { q2: 'yes' })).toBe(true)
    expect(precheckAsked('q5', {})).toBe(false)
    expect(precheckAsked('q5', { q4: 'no' })).toBe(false)
    expect(precheckAsked('q5', { q4: 'yes' })).toBe(true)
  })

  it('最短の道は Q1→Q2→Q4→チェック結果。尋ねない質問は飛ばす', () => {
    expect(precheckNext('q1', { q1: 'yes' })).toBe('q2')
    expect(precheckNext('q2', { q1: 'yes', q2: 'no' })).toBe('q4')
    expect(precheckNext('q4', { q1: 'yes', q2: 'no', q4: 'no' })).toBe('done')
    // 引き継ぐ・ほかのツールを使う、と答えたときは Q3・Q5 も尋ねる。
    expect(precheckNext('q2', { q2: 'yes' })).toBe('q3')
    expect(precheckNext('q3', { q2: 'yes', q3: 'no' })).toBe('q4')
    expect(precheckNext('q4', { q4: 'yes' })).toBe('q5')
    expect(precheckNext('q5', { q4: 'yes', q5: 'both' })).toBe('done')
  })

  it('答えていない・行き止まり（Q1いいえ・Q3はい）では次の面を返さない＝先へ進めない', () => {
    expect(precheckNext('q1', {})).toBeNull()
    expect(precheckNext('q2', { q1: 'yes' })).toBeNull()
    expect(precheckNext('q1', { q1: 'no' })).toBeNull()
    expect(precheckNext('q3', { q2: 'yes', q3: 'yes' })).toBeNull()
    expect(precheckNext('done', { q1: 'yes' })).toBeNull()
    expect(precheckBlocked('q1', {}, {})).toBe(true)
    expect(precheckBlocked('q1', { q1: 'no' }, {})).toBe(true)
    expect(precheckBlocked('q3', { q2: 'yes', q3: 'yes' }, {})).toBe(true)
    expect(precheckBlocked('q1', { q1: 'yes' }, {})).toBe(false)
    expect(precheckBlocked('done', { q1: 'yes' }, {})).toBe(false)
  })

  it('Q2=はいは、認証済みアカウントの印にチェックするまで進めない（①-9）', () => {
    const note = precheckNote('q2', { q2: 'yes' })
    expect(note?.tone).toBe('warn')
    expect(note?.ack).toEqual({ key: PRECHECK_VERIFIED_ACK, label: '認証済みアカウントであることを確認した' })
    expect(precheckBlocked('q2', { q2: 'yes' }, {})).toBe(true)
    expect(precheckBlocked('q2', { q2: 'yes' }, { [PRECHECK_VERIFIED_ACK]: true })).toBe(false)
    // 引き継がないなら印も案内も出さない。
    expect(precheckNote('q2', { q2: 'no' })).toBeNull()
    expect(precheckBlocked('q2', { q2: 'no' }, {})).toBe(false)
  })

  it('案内のリンクは、外のページだけ別タブ。相談は管理画面の中の画面へ', () => {
    expect(precheckNote('q1', { q1: 'no' })?.link).toMatchObject({ href: 'https://manager.line.biz/', external: true })
    expect(precheckNote('q2', { q2: 'yes' })?.link).toMatchObject({ href: 'https://www.lycbiz.com/jp/service/line-official-account/account-type/', external: true })
    const support = precheckNote('q3', { q2: 'yes', q3: 'yes' })?.link
    expect(support?.href).toBe('/hq/support')
    expect(support?.external).toBeUndefined()
    // Q5は案内だけでリンクを持たない（3つとも文を出す）。
    for (const answer of ['both', 'switch', 'try'] as const) {
      const note = precheckNote('q5', { q4: 'yes', q5: answer })
      expect(note?.link).toBeUndefined()
      expect(note?.title.length).toBeGreaterThan(0)
    }
  })

  it('「戻る」はひとつ前に尋ねた質問へ。①の先頭からは戻らない', () => {
    const answers = { q1: 'yes', q2: 'no', q4: 'no' } as const
    expect(precheckBack('q1', answers)).toBeNull()
    expect(precheckBack('q2', answers)).toBe('q1')
    expect(precheckBack('q4', answers)).toBe('q2')
    expect(precheckBack('done', answers)).toBe('q4')
    // Q3を尋ねた道では、Q4の前はQ3。
    expect(precheckBack('q4', { q2: 'yes', q3: 'no' })).toBe('q3')
  })

  it('答えの一覧は答えた質問だけ、「このあとの質問」は尋ねないと決まった質問を外す', () => {
    expect(precheckSummary('q2', { q1: 'yes', q2: 'no' })).toEqual([
      { key: 'q1', label: 'Q1. LINE公式アカウント', value: 'あります' },
      { key: 'q2', label: 'Q2. 友だちの引き継ぎ', value: 'いいえ、引き継ぎません' },
    ])
    expect(precheckSummary('done', { q1: 'yes', q2: 'no', q4: 'no' }).map((row) => row.key)).toEqual(['q1', 'q2', 'q4'])
    expect(precheckSummary('q1', {})).toEqual([])
    // 未定のあいだは括弧の注記を付け、尋ねないと決まったら一覧から消す。
    expect(precheckUpcoming('q1', {}).map((row) => row.text)).toEqual([
      'Q2. いまの友だちを引き継ぎますか？',
      'Q3. 友だちの数は50万人を超えていますか？（引き継ぐときだけ）',
      'Q4. ほかのLINE配信ツールを使っていますか？',
      'Q5. そのツールを、これからどうしますか？（使っているときだけ）',
    ])
    expect(precheckUpcoming('q2', { q1: 'yes', q2: 'no' }).map((row) => row.key)).toEqual(['q4', 'q5'])
    expect(precheckUpcoming('q4', { q1: 'yes', q2: 'no', q4: 'no' })).toEqual([])
    expect(precheckUpcoming('done', { q1: 'yes' })).toEqual([])
  })

  it('札は「質問 n」。最後だけ「チェック完了」で、結果は4項目', () => {
    expect(precheckStateLabel('q1')).toBe('質問 1')
    expect(precheckStateLabel('q5')).toBe('質問 5')
    expect(precheckStateLabel('done')).toBe('チェック完了')
    expect(PRECHECK_RESULT.map((item) => item.title)).toEqual(['用意するもの', '接続後に変わること', '作り直すもの', 'かかる時間'])
    for (const item of PRECHECK_RESULT) expect(item.body.length).toBeGreaterThan(0)
  })

  it('下書きから戻すとき、知らない答えは捨て、尋ねない質問を指していたら先頭へ戻す', () => {
    expect(readPrecheckAnswers({ q1: 'yes', q2: 'maybe', q4: 'yes', q5: 'switch' })).toEqual({ q1: 'yes', q4: 'yes', q5: 'switch' })
    expect(readPrecheckAnswers({ q5: 'zzz' })).toEqual({})
    expect(readPrecheckAnswers(null)).toEqual({})
    expect(readPrecheckAt('q3', {})).toBe('q1')
    expect(readPrecheckAt('q3', { q2: 'yes' })).toBe('q3')
    expect(readPrecheckAt('done', {})).toBe('done')
    expect(readPrecheckAt('zzz', {})).toBe('q1')
  })
})

describe('v07（LINE新規追加_v07.pen・2026-10-18承認）の小さな計算', () => {
  it('②は3つ、③は2つの小さな段。札は「Step 2 / 3」の形で、段の無い画面では出さない', () => {
    expect([subTotal(1), subTotal(2), subTotal(3), subTotal(4), subTotal(5)]).toEqual([0, 3, 2, 0, 0])
    expect(stepLabel(2, 2)).toBe('Step 2 / 3')
    expect(stepLabel(3, 2)).toBe('Step 2 / 2')
    expect(stepLabel(1, 1)).toBe('')
    // 範囲の外を渡されても札は壊さない。
    expect(stepLabel(3, 9)).toBe('Step 2 / 2')
  })

  it('②は Messaging API の2項目と LINEログインの2項目を別々に調べる（Step1でログインの欄を責めない）', () => {
    const empty = { channelId: '', channelSecret: '', loginChannelId: '', loginChannelSecret: '' }
    expect(Object.keys(messagingApiErrors(empty)).sort()).toEqual(['channelId', 'channelSecret'])
    expect(Object.keys(loginChannelErrors(empty)).sort()).toEqual(['loginChannelId', 'loginChannelSecret'])
    expect(messagingApiErrors({ channelId: 'abc', channelSecret: 'x' }).channelId).toBe('チャネルIDは半角数字で入力してください。')
    expect(messagingApiErrors({ channelId: '2001', channelSecret: 'x' })).toEqual({})
    expect(loginChannelErrors({ loginChannelId: '2002', loginChannelSecret: 'x' })).toEqual({})
  })

  it('②Step2の4つ・Step3の2つは、すべて入れないと次の段へ進めない', () => {
    expect(WEBHOOK_ACKS).toHaveLength(4)
    expect(LOGIN_ACKS).toHaveLength(2)
    expect(allAcked(WEBHOOK_ACKS, {})).toBe(false)
    expect(allAcked(WEBHOOK_ACKS, { webhookUse: true, webhookRedelivery: true })).toBe(false)
    expect(allAcked(WEBHOOK_ACKS, { webhookUse: true, webhookRedelivery: true, webhookErrorStats: true })).toBe(false)
    expect(allAcked(WEBHOOK_ACKS, { webhookUrlPasted: true, webhookUse: true, webhookRedelivery: true, webhookErrorStats: true })).toBe(true)
    expect(allAcked(LOGIN_ACKS, { addFriendLink: true, published: true })).toBe(true)
  })

  it('②のチェックの文は承認した v07 のまま。どの行にも下の一文（理由）が付く', () => {
    expect(WEBHOOK_ACKS.map((ack) => ack.label)).toEqual([
      'Webhook URL を貼り付けて「更新」を押した',
      'Webhookの利用をONにした',
      'Webhookの再送をONにした',
      'エラーの統計情報をONにした',
    ])
    expect(LOGIN_ACKS.map((ack) => ack.label)).toEqual([
      '友だち追加オプションで、この公式アカウントをリンクした',
      'チャネルを「開発中」から「公開済み」にした',
    ])
    expect(WEBHOOK_ACKS[0].note).toBe('貼り付けて更新しないと、下の3つのスイッチが表示されません。')
    expect(LOGIN_ACKS[1].note).toBe('開発中のままだと、お客さま側でログインの画面が開きません。')
    for (const ack of [...WEBHOOK_ACKS, ...LOGIN_ACKS]) expect(ack.note.length).toBeGreaterThan(0)
  })

  it('LINE Developers の行き先は入れたチャネルIDのページ。空ならコンソールの入口', () => {
    expect(developerChannelUrl(' 2001 ')).toBe('https://developers.line.biz/console/channel/2001')
    expect(developerChannelUrl('')).toBe('https://developers.line.biz/console/')
  })

  it('③Step1の5行は上から順に見せる。手前は本当の合否、今の行は確認中、後ろは待機中', () => {
    const waiting = toV06CheckRows(null, { running: false, cursor: 0 })
    expect(waiting.map((row) => row.phase)).toEqual(['waiting', 'waiting', 'waiting', 'waiting', 'waiting'])
    // 返事が来る前：先頭だけが「確認中」。
    const first = toV06CheckRows(null, { running: true, cursor: 0 })
    expect(first.map((row) => row.phase)).toEqual(['checking', 'waiting', 'waiting', 'waiting', 'waiting'])
    // 返事あり・3行目まで見せた途中：1・2行目は OK、3行目が確認中。
    const mid = toV06CheckRows(connection('failed'), { running: true, cursor: 2 })
    expect(mid.map((row) => row.phase)).toEqual(['ok', 'ok', 'checking', 'waiting', 'waiting'])
    // 演出が終われば返事のとおり。
    const settled = toV06CheckRows(connection('failed'), { running: false, cursor: 5 })
    expect(settled.map((row) => row.phase)).toEqual(['ok', 'ok', 'error', 'waiting', 'waiting'])
    expect(allV06RowsOk(settled)).toBe(false)
    expect(allV06RowsOk(toV06CheckRows(connection('passed'), { running: false, cursor: 5 }))).toBe(true)
    expect(allV06RowsOk(waiting)).toBe(false)
  })

  it('③Step1の5行の文は、承認済みの v07（Lwxyh）の5状態をそのまま出す', () => {
    const titles = ['LINEとつながるかの確認', '同じプロバイダーかの確認', 'Webhook URL の登録', 'アカウント名・@ID・アイコンの取り込み', '友だち追加の窓口（LIFF）の用意']
    // 押す前（EKLKb）：5行とも「これから何をするか」の文。
    const idle = toV06CheckRows(null, { running: false, cursor: 0 })
    expect(idle.map((row) => row.title)).toEqual(titles)
    expect(idle[0].detail).toBe('いただいた4項目で、2つのチャネルに接続できるか試します。')
    expect(idle[3].detail).toBe('LINEから読み取って自動で表示します。入力はいりません。')
    // 確認中（fwhGO）：今の行は「いま確認しています」、後ろは「前の確認が終わってから」。
    const mid = toV06CheckRows(connection('failed'), { running: true, cursor: 1 })
    expect(mid[0].detail).toBe('2つのチャネルに接続できました。')
    expect(mid[1].detail).toBe('いま確認しています。そのままお待ちください。')
    expect(mid[2].detail).toBe('前の確認が終わってから行います。')
    // すべて OK（V9Jbn）。
    const ok = toV06CheckRows(connection('passed'), { running: false, cursor: 5 })
    expect(ok.map((row) => row.detail)).toEqual([
      '2つのチャネルに接続できました。',
      '同じプロバイダーの中にありました。',
      'Webhook URL を登録しました。',
      'アカウント名・@ID・アイコンを取り込みました。',
      '友だち追加の窓口（LIFF）を作りました。',
    ])
    // Webhook が OFF（eqJbD）：後ろの2行は Webhook 待ちの言い方。
    const off = toV06CheckRows(connection('failed'), { running: false, cursor: 5 })
    expect(off[2].detail).toBe('URLは登録できましたが、「Webhookの利用」がOFFのままです。上の案内のとおりONにしてください。')
    expect(off[3].detail).toBe('Webhookの確認が終わってから取り込みます。')
    expect(off[4].detail).toBe('Webhookの確認が終わってから作ります。')
  })

  it('③Step1の演出は止まった行で終える（止まった先を「確認中」にして見せない）', () => {
    const rows = toV06CheckRows(connection('failed'), { running: true, cursor: 3 })
    expect(nextCursor(rows, 0)).toBe(1)
    expect(nextCursor(rows, 2)).toBeNull()
    expect(nextCursor(rows, 5)).toBeNull()
  })

  it('③Step1のボタンの文は、押す前・確認中・やり直し・終わりで変わる', () => {
    expect(checkActionLabel({ running: false, attempted: false, allOk: false })).toBe('接続を確かめる')
    expect(checkActionLabel({ running: true, attempted: true, allOk: false })).toBe('確認しています…')
    expect(checkActionLabel({ running: false, attempted: true, allOk: false })).toBe('もう一度確かめる')
    expect(checkActionLabel({ running: false, attempted: true, allOk: true })).toBe('確認が終わりました')
  })

  it('③Step1の案内箱は、Webhook がオフなら青、ほかの行が止まったら赤で文を分ける', () => {
    expect(checkStage(null, false)).toBe('idle')
    expect(checkStage(null, true)).toBe('running')
    expect(checkStage(connection('passed'), false)).toBe('done')
    expect(checkStage(connection('failed'), false)).toBe('webhookOff')
    const rows = toV06CheckRows(connection('failed'), { running: false, cursor: 5 })
    expect(checkErrorText('done', rows)).toBeNull()
    expect(checkErrorText('idle', rows)).toBeNull()
    expect(checkErrorText('running', rows)).toBeNull()
    const off = checkErrorText('webhookOff', rows)
    expect(off?.tone).toBe('info')
    expect(off?.title).toBe('「Webhookの利用」をONにしてください')
    expect(off?.body).toContain('Webhook設定 で「Webhookの利用」をONにし')
    expect(off?.body).toContain('URLの入力は不要です')
    // プロバイダーが別（Tn6tJ）は赤い箱。
    const providerRows: V06CheckRow[] = rows.map((row, i) => (i === 1 ? { ...row, phase: 'error' } : i === 2 ? { ...row, phase: 'waiting' } : row))
    const bad = checkErrorText('error', providerRows)
    expect(bad?.tone).toBe('danger')
    expect(bad?.title).toBe('LINEログインのチャネルを同じプロバイダーに作り直してください')
    expect(bad?.body).toContain('Messaging API とは別のプロバイダーにありました')
    expect(bad?.body).toContain('入力済みの内容はそのまま残っています')
    // ほかの行で止まったときは、その行の文を添えた赤い箱。
    const other = checkErrorText('error', rows)
    expect(other?.tone).toBe('danger')
    expect(other?.title).toContain('Webhook URL の登録')
    expect(other?.body).toContain('もう一度確かめて')
  })

  it('④のひな型は6枚。6つの正式キーを選べる', () => {
    const options = templateOptions()
    expect(options).toHaveLength(6)
    expect(options.filter((option) => option.enabled).map((option) => option.key)).toEqual(['restaurant', 'salon', 'consult', 'ec', 'lesson', 'standard'])
    expect(options[0].node).toBe('MELvy')
    expect(options.map((option) => option.node)).toEqual(['MELvy', 'J1tGCr', 'U74H4', 'Y0ldyt', 'd0vdd', 'H2d2y'])
    expect(options.map((option) => option.label)).toEqual(['飲食店', 'サロン', '面談・相談', 'EC', '教室・レッスン', '標準'])
    expect(options[0].note).toBe('今日の来店（時刻・席・人数）を先頭に出します。席の予約が始めから使えます')
    expect(options[5].note).toBe('今のダッシュボードのままです。カードは、あとから自分で足し引きできます')
  })

  it('引き継ぎ中の進み具合：総人数が分からないうちは割合を出さず、速さから残り時間を見積もる', () => {
    const half = handoverProgress({ imported: 60, total: 120, elapsedSeconds: 30, running: true })
    expect(half.rate).toBe(50)
    expect(half.perMinute).toBe(120)
    expect(half.remainingSeconds).toBe(30)
    expect(half.done).toBe(false)
    const unknown = handoverProgress({ imported: 10, total: null, elapsedSeconds: 60, running: true })
    expect(unknown.rate).toBe(0)
    expect(unknown.remainingSeconds).toBeNull()
    const finished = handoverProgress({ imported: 120, total: 120, elapsedSeconds: 60, running: false })
    expect(finished.rate).toBe(100)
    expect(finished.remainingSeconds).toBe(0)
    expect(finished.done).toBe(true)
    // 始まったばかりで何も進んでいなければ速さは出さない（0人／分と言わない）。
    expect(handoverProgress({ imported: 0, total: 120, elapsedSeconds: 2, running: true }).perMinute).toBeNull()
  })

  it('長さは日本語で出す（0以下は出さない）', () => {
    expect(formatJaDuration(200)).toBe('3分20秒')
    expect(formatJaDuration(120)).toBe('2分')
    expect(formatJaDuration(45)).toBe('45秒')
    expect(formatJaDuration(3900)).toBe('1時間5分')
    expect(formatJaDuration(3600)).toBe('1時間')
    expect(formatJaDuration(0)).toBe('')
    expect(formatJaDuration(null)).toBe('')
  })

  it('下書きは小さな段も戻す（画面に無い段の数は1に丸める）', () => {
    expect(readDraft(storage({ step: 2, sub: 3, channelId: '2001' }))).toMatchObject({ step: 2, sub: 3 })
    expect(readDraft(storage({ step: 2, sub: 9, channelId: '2001' }))).toMatchObject({ step: 2, sub: 1 })
    expect(readDraft(storage({ step: 4, sub: 2, channelId: '2001' }))).toMatchObject({ step: 4, sub: 1 })
    expect(readDraft(storage({ step: 2, channelId: '2001' }))).toMatchObject({ sub: 1 })
  })
})
