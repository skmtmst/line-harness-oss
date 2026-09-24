import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const OVERVIEW = fs.readFileSync(path.join(__dirname, 'nen-overview.tsx'), 'utf8')
const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const PREVIEW = fs.readFileSync(path.join(__dirname, 'line-preview.tsx'), 'utf8')
const NEW_COLUMN = fs.readFileSync(path.join(__dirname, 'columns/new/page.tsx'), 'utf8')
const EDIT = fs.readFileSync(path.join(__dirname, 'edit/page.tsx'), 'utf8')

/*
 * ★V6 37-6（`z4q1K`）自動配信／37-6-A（`u66A0`）コラム の画面契約。
 * 設計の骨組み（タブ・数値カード・案内帯・一覧操作・表・右パネル・下部追従バー）と、
 * 点検 #512／#727／#733 で決めた振る舞いが残っていることを見る。
 */
describe('V6 37-6 NEN配信の画面契約', () => {
  it('2つの正本ノードと4つのタブへ対応させる', () => {
    expect(OVERVIEW).toContain("'u66A0'")
    expect(OVERVIEW).toContain("'z4q1K'")
    for (const tab of ['自動配信', 'コラム', '送った履歴', '停止中']) {
      expect(OVERVIEW).toContain(`label: '${tab}'`)
    }
    // ペット・記念日はマイペット（★V6 37-3）へ移した。旧タブと旧ノードは残さない。
    for (const gone of ['ペット・記念日', '配信フロー', 'NENコラム', "'VLMGH'", "'q4lajm'"]) {
      expect(OVERVIEW).not.toContain(gone)
    }
  })

  it('L 一覧型の順（パンくず → タブ → 数値カード → 案内帯 → 一覧操作 → 表）', () => {
    // 骨組みは NenOverview の JSX から順に読む（Kpis 部品の定義位置は見ない）。
    const body = OVERVIEW.slice(OVERVIEW.indexOf('export function NenOverview('))
    const order = ['data-design="Crumb"', 'data-design="Tabs"', '<Kpis ', 'data-design="Note"', 'data-design="ListControls"', 'data-design="Table"']
    const positions = order.map((marker) => body.indexOf(marker))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('数値カードは今月・先月／開封／配信からの注文／届かなかった の4枚', () => {
    for (const label of ['送った数', '先月', '開封', '配信からの注文', '届かなかった', '友だち解除']) {
      expect(OVERVIEW).toContain(label)
    }
    // 今月・先月は端末の時差ではなく日本時間の月の範囲で取る。
    expect(PAGE).toContain('jstMonthRange(now)')
    expect(PAGE).toContain('jstMonthRange(now, -1)')
    expect(PAGE).toContain('from: thisMonth.from, to: thisMonth.to')
    // 自動配信の開封は LINE から取れない。取れない理由を隠さない。
    // （自動配信の表の開封列を外したため、理由は数値カードの説明と表の注記に残す）
    expect(OVERVIEW).toContain('LINEから個人開封を取得できません')
    expect(OVERVIEW).toContain('自動配信は開封を取得できません')
  })

  it('自動配信の表は 配信／きっかけ／対象／送信／注文／状態／操作（開封の列は置かない）', () => {
    for (const label of ['<Th>配信</Th>', 'きっかけ</Th>', '対象</Th>', '送信</Th>', '注文</Th>', '状態</Th>']) {
      expect(OVERVIEW).toContain(label)
    }
    // 開封の列は「—」しか並ばないので自動配信の表には置かない。
    // （送った履歴の表には「取得不可」の列が残るので、自動配信のパネル内だけ見る）
    const autoPanel = OVERVIEW.slice(OVERVIEW.indexOf('function AutoPanel('), OVERVIEW.indexOf('function CouponDrawer('))
    expect(autoPanel).toContain('注文</Th>')
    expect(autoPanel).not.toContain('開封</Th>')
    expect(OVERVIEW).toContain('自動配信は開封を取得できません')
    expect(OVERVIEW).toContain('formatCampaignTiming(setting)')
    expect(OVERVIEW).toContain('formatCampaignAudience(setting)')
    expect(OVERVIEW).toContain('配信中</StatusBadge>')
    expect(OVERVIEW).toContain('停止中</StatusBadge>')
    // 編集は専用画面へ。その他は 中身を見る／テスト送信／止める・動かす。
    expect(OVERVIEW).toContain('/nen-campaigns/edit?key=')
    expect(OVERVIEW).toContain("label: '中身を見る'")
    expect(OVERVIEW).toContain("setting.isEnabled ? '止める' : '動かす'")
    // 停止・再開は専用の口（#659）。
    expect(PAGE).toContain('api.nenCampaigns.setEnabled(')
  })

  it('自動配信の案内帯は1文だけにし、残りは開閉する欄へ入れる', () => {
    expect(OVERVIEW).toContain('をきっかけに、決めた日数後に自動で送ります。')
    expect(OVERVIEW).toContain('<Disclosure size="compact" title="送られる仕組み">')
    expect(OVERVIEW).toContain('で確認できます。')
  })

  it('コラムは一覧と右パネル（LINEに届くカード／誰に・いつ送るか）と下部追従バー', () => {
    for (const label of ['LINEに届くカード', '誰に・いつ送るか', '送る相手', '送る時', '今すぐ', '日時を予約', '自分にテスト送信', 'この内容で予約する', 'この内容で送る']) {
      expect(OVERVIEW).toContain(label)
    }
    expect(OVERVIEW).toContain('<StickyBar')
    expect(OVERVIEW).toContain('ColumnLinePreview')
    // 差し込みは実送信と同じ「大切なご家族」で見せる（コラムはペット情報を持たない）。
    expect(PREVIEW).toContain("COLUMN_PET_NAME_FALLBACK = '大切なご家族'")
    // 送る相手の人数は実口 columns-preview から。
    expect(PAGE).toContain('api.nenCampaigns.columnAudience(')
    // ヘッダーは ★V6 37-6-A どおり「ECのコラムを取り込む」（未割り当てのECコラムを割り当てる実口）。
    expect(PAGE).toContain('ECのコラムを取り込む')
    expect(PAGE).toContain('api.nenCampaigns.importColumns(')
    // LINE配信の状態は日本語で（内部値をそのまま出さない）。
    expect(OVERVIEW).toContain("draft: '未配信'")
    expect(OVERVIEW).toContain("sent: '配信済み'")
    expect(OVERVIEW).toContain('columnStatusLabel[column.deliveryStatus]')
    expect(OVERVIEW).toContain('metric?.articleOpened.value')
  })

  it('読込失敗と空状態を共通状態部品で示す', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('もう一度読み込む')
    expect(OVERVIEW).toContain('kind="empty"')
    expect(OVERVIEW).toContain('売らない配信です。ここで信用がたまると、売る配信が届きやすくなります。')
  })

  it('タブごとに取り、失敗はそのタブだけの帯で示す(点検 #512 の中3)', () => {
    expect(PAGE).toContain('loadTab')
    expect(PAGE).toContain('tabErrors')
    expect(PAGE).toContain('tone="danger"')
    expect(PAGE).not.toContain('loadError')
    // 操作後は関係するタブだけ読み直す。
    expect(PAGE).toContain("await loadTab('columns')")
    expect(PAGE).toContain("await loadTab('history')")
    expect(PAGE).not.toContain('await load()')
  })

  it('コラム作成で対象・予約・読了後の操作を実APIへ接続する', () => {
    expect(NEW_COLUMN).toContain('data-design-node="ymXJK"')
    expect(NEW_COLUMN).toContain('前のコラムを下敷きにする')
    expect(NEW_COLUMN).toContain('columnAudience')
    expect(NEW_COLUMN).toContain('配信日時（日本時間）')
    expect(NEW_COLUMN).toContain('読了イベント名')
    expect(NEW_COLUMN).toContain('読了後に付けるタグ')
  })

  it('一覧側の配信日時も新規作成と同じく日本時間で送る(点検 #512 の中5)', () => {
    // 端末の時差で解釈する new Date(...).toISOString() を使わない。
    expect(OVERVIEW).toContain('publishedAtIso(plan.scheduledAt)')
    expect(OVERVIEW).not.toContain('new Date(event.target.value).toISOString()')
  })

  it('コラム作成のタグ候補はこのアカウントのものだけ(点検 #512 の中4)', () => {
    expect(NEW_COLUMN).toContain('visibleAccountTags')
    expect(NEW_COLUMN).toContain('accountTags')
  })

  it('今すぐ送る件数は口と同じ決めごとの数を使う(点検 #512 の中2)', () => {
    // 一覧の窓付き集計(summary.pending)を送ると、変わっていないのに409になる。
    expect(PAGE).toContain('overviewRes.data.jobs.pending')
    expect(PAGE).not.toContain('deliveryList.summary.pending')
  })

  it('再送理由は口の上限500字を超えて送れない(点検 #512 の軽6)', () => {
    expect(OVERVIEW).toContain('maxLength={500}')
    expect(OVERVIEW).toContain('500文字まで')
  })

  it('紹介文の上限は一覧側と編集画面で1500字にそろえる(点検 #512 の軽7)', () => {
    expect(OVERVIEW).toContain('maxLength={1500}')
    expect(EDIT).toContain('maxLength={1500}')
  })

  it('クーポン数値は口の範囲の前に具体的な直し方を出す(点検 #512 の軽5)', () => {
    expect(PAGE).toContain('割引の額は1〜100,000円の整数で入力してください')
    expect(PAGE).toContain('使える日数は1〜365日の整数で入力してください')
    expect(PAGE).toContain('savingCoupon')
    // クーポンの決めごとは誕生日配信の行から右パネルで開く。
    expect(OVERVIEW).toContain("label: 'クーポンの決めごと'")
    expect(OVERVIEW).toContain('誕生日は3日前の10:00に送ります')
  })

  it('配信予約は確認ダイアログを挟む(点検 #512 の中9)', () => {
    expect(OVERVIEW).toContain('ConfirmDialog')
    expect(OVERVIEW).toContain('confirmDeliver')
    expect(OVERVIEW).toContain('を配信予約しますか？')
    // ボタン直結のワンクリック実行は残さない。
    expect(OVERVIEW).not.toContain('onClick={() => onDeliver(column)}')
  })

  it('送った履歴は新しい取得結果と状態の日本語を使う', () => {
    expect(OVERVIEW).toContain('delivery.lineAccountName')
    expect(OVERVIEW).toContain('deliveryTriggerLabel(delivery.campaignKey)')
    expect(OVERVIEW).toContain('delivery.reaction.reason')
    expect(OVERVIEW).toContain('onShowDetail(delivery.id)')
    expect(OVERVIEW).toContain('取得不可')
    expect(OVERVIEW).not.toContain('12pt')
  })
})
