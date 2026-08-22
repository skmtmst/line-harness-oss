import Link from 'next/link'
import styles from './friend-attributes-v4-states.module.css'

export type FriendAttributesV4State = 'fields' | 'marks' | 'searches' | 'csv'

type Metric = { label: string; value: string; note: string }
type Cell = { text: string; tone?: 'red' | 'amber' | 'green' | 'violet' | 'blue' | 'gray' }
type Row = Cell[]
type ScreenSpec = {
  nodeId: string
  sourceNodeId: string
  description: string
  primary: string
  secondaryAction?: string
  metrics: Metric[]
  guide: string
  filters: string[]
  headers: string[]
  rows: Row[]
  safetyTitle?: string
  safetyText?: string
}

const tabs: Array<{ key: FriendAttributesV4State | 'tags'; label: string }> = [
  { key: 'tags', label: 'タグ' },
  { key: 'fields', label: '友だち情報欄' },
  { key: 'marks', label: '対応マーク' },
  { key: 'searches', label: '保存した検索' },
]

const screenData: Record<Exclude<FriendAttributesV4State, 'csv'>, ScreenSpec> = {
  fields: {
    nodeId: 'C2g1N',
    sourceNodeId: 'ZAFby',
    description: '7種の基本型と現行の拡張型を、既定値・フォルダ・使用先と一緒に管理します。',
    primary: '＋ 項目を追加',
    metrics: [
      { label: '項目数', value: '12件', note: '使用中 9件' },
      { label: '登録済み友だち', value: '48人', note: '1項目以上を登録' },
      { label: 'フォーム連携', value: '6件', note: '回答の登録先' },
      { label: '今月の更新', value: '3件', note: '追加・編集' },
    ],
    guide: '既定値は友だち情報が空欄のときの送信値です。種類は新規登録後に変更せず、回答フォーム・友だち詳細・変数挿入で同じ定義を使います。',
    filters: ['項目名で検索', '種類：すべて'],
    headers: ['順番', '項目名', '種類', '使用中', '回答フォーム', '表示先', '操作'],
    rows: [
      [{ text: '☰ 1' }, { text: '愛犬のお名前', tone: 'red' }, { text: 'テキスト' }, { text: '48人' }, { text: '回答フォーム 3個' }, { text: '友だち詳細・テンプレート差し込み' }, { text: '編集　削除', tone: 'blue' }],
      [{ text: '☰ 2' }, { text: 'お住まい', tone: 'amber' }, { text: '選択肢' }, { text: '42人' }, { text: '回答フォーム 2個' }, { text: '友だち詳細・配信の絞り込み' }, { text: '編集　削除', tone: 'blue' }],
      [{ text: '☰ 3' }, { text: '生年月日', tone: 'green' }, { text: '日付' }, { text: '35人' }, { text: '回答フォーム 1個' }, { text: '友だち詳細・誕生日配信' }, { text: '編集　削除', tone: 'blue' }],
      [{ text: '☰ 4' }, { text: '便の状態', tone: 'violet' }, { text: '選択肢' }, { text: '18人' }, { text: '回答フォーム 2個' }, { text: '友だち詳細・オートメーション' }, { text: '編集　削除', tone: 'blue' }],
    ],
    safetyTitle: '既定値・種類・削除の安全確認',
    safetyText: '既定値は空欄送信事故を防ぎます。種類は新規登録後に変更不可とし、削除時は影響する友だち数・フォーム・変数挿入先を表示します。',
  },
  marks: {
    nodeId: 'S04qZM',
    sourceNodeId: 'yTPY6',
    description: '問い合わせの状態を表すマークを、受信箱と友だち管理で共通利用します。',
    primary: '＋ マークを追加',
    metrics: [
      { label: 'マークの種類', value: '4件', note: '使用中 4件' },
      { label: '未対応', value: '6人', note: '全体の 12.5%' },
      { label: '対応中', value: '2人', note: '担当者あり' },
      { label: '過去7日の変更', value: '18回', note: '担当者別に記録' },
    ],
    guide: '受信箱・友だち一覧・友だち詳細で共通利用し、メッセージ受信時の自動変更と初期値を同じ画面で設定します。',
    filters: ['マーク名で検索', '利用状態：すべて'],
    headers: ['順番', 'マーク', '使用中', '初期値', '自動変更', '表示先', '操作'],
    rows: [
      [{ text: '☰ 1' }, { text: '未対応', tone: 'red' }, { text: '6人' }, { text: '新着時の初期値' }, { text: '受信時・期限超過' }, { text: '受信箱・友だち一覧・ダッシュボード・配信・オートメーション' }, { text: '編集　初期値のため削除不可', tone: 'gray' }],
      [{ text: '☰ 2' }, { text: '対応中', tone: 'amber' }, { text: '2人' }, { text: '—' }, { text: '担当者割当時' }, { text: '受信箱・友だち一覧・ダッシュボード' }, { text: '編集　削除', tone: 'blue' }],
      [{ text: '☰ 3' }, { text: '対応済', tone: 'green' }, { text: '34人' }, { text: '—' }, { text: '手動・返信完了時' }, { text: '受信箱・友だち一覧・配信' }, { text: '編集　削除', tone: 'blue' }],
      [{ text: '☰ 4' }, { text: '保留', tone: 'violet' }, { text: '3人' }, { text: '—' }, { text: '条件一致時' }, { text: '受信箱・友だち一覧' }, { text: '編集　削除', tone: 'blue' }],
    ],
    safetyTitle: '受信時自動変更・削除・初期値の安全確認',
    safetyText: '「受信時に未対応へ変更」の全体設定を一覧上部で確認できます。削除時は影響人数と置き換え先を表示し、初期値は削除できません。',
  },
  searches: {
    nodeId: 'WDAkW',
    sourceNodeId: 'cxtem',
    description: '15軸の絞り込みを保存し、一覧・配信・アクションから同じ条件を再利用します。',
    primary: '＋ 条件を作成',
    secondaryAction: '保存条件からコピー',
    metrics: [
      { label: '保存した条件', value: '12件', note: '上限50件' },
      { label: '配信で使用中', value: '5件', note: '変更時は影響確認' },
      { label: '該当者0人', value: '2件', note: '条件の見直し候補' },
      { label: '今月の呼び出し', value: '84回', note: '配信・自動処理' },
    ],
    guide: 'AND群とOR群、友だち情報の10演算子を組み合わせ、保存した条件からコピーして再利用します。',
    filters: ['条件名・用途で検索', '使用先：すべて', '該当人数：すべて'],
    headers: ['条件名', '条件の要約', '該当', '共有', '使用先', '更新者・日時', '操作'],
    rows: [
      [{ text: 'VIPかつ未契約' }, { text: 'タグ VIP / 未契約・AND' }, { text: '18人' }, { text: '全員', tone: 'blue' }, { text: '一斉配信2・自動処理1' }, { text: 'Kenta 8/20 19:20' }, { text: '編集　友だち一覧へ　削除', tone: 'blue' }],
      [{ text: '誕生日30日前' }, { text: '誕生日が今日から30日以内' }, { text: '12人' }, { text: '自分だけ', tone: 'gray' }, { text: 'リマインダ1' }, { text: 'Kenta 8/20 18:10' }, { text: '編集　友だち一覧へ　削除', tone: 'blue' }],
      [{ text: '未対応・担当なし' }, { text: '対応マーク未対応 AND 担当者なし' }, { text: '6人' }, { text: '全員', tone: 'blue' }, { text: '受信箱' }, { text: 'Kenta 8/19 20:05' }, { text: '編集　友だち一覧へ　削除', tone: 'blue' }],
      [{ text: '購入者または予約者' }, { text: '購入タグ OR 予約あり' }, { text: '42人' }, { text: '全員', tone: 'blue' }, { text: '一斉配信3' }, { text: 'Masato 8/18 14:30' }, { text: '編集　友だち一覧へ　削除', tone: 'blue' }],
      [{ text: '離脱注意' }, { text: '最終返信60日以上 AND 有効友だち' }, { text: '0人' }, { text: '自分だけ', tone: 'gray' }, { text: '未使用' }, { text: 'Kenta 8/17 11:22' }, { text: '編集　友だち一覧へ　削除', tone: 'blue' }],
    ],
  },
}

function Button({ children, primary = false }: { children: React.ReactNode; primary?: boolean }) {
  return <button type="button" className={`${styles.button} ${primary ? styles.primaryButton : ''}`}>{children}</button>
}

function Tabs({ active }: { active: FriendAttributesV4State | 'tags' }) {
  return <nav className={styles.tabs} aria-label="友だち属性の表示切替">{tabs.map((tab) => (
    <Link key={tab.key} href={tab.key === 'tags' ? '/tags-v3' : `/visual-qa/friend-attributes-v4-states?state=${tab.key}`} className={active === tab.key ? styles.activeTab : ''}>{tab.label}</Link>
  ))}</nav>
}

function Metrics({ metrics }: { metrics: Metric[] }) {
  return <section className={styles.metrics}>{metrics.map((metric) => <article key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small></article>)}</section>
}

function RowActions({ value }: { value: string }) {
  const actions = value.split('　')
  return <span className={styles.rowActions}>{actions.map((action) => {
    const className = action === '編集'
      ? styles.editAction
      : action === '友だち一覧へ'
        ? styles.linkAction
        : action === '削除'
          ? styles.deleteAction
          : styles.disabledAction
    return <button key={action} type="button" className={className}>{action}</button>
  })}</span>
}

function Table({ headers, rows, wide }: { headers: string[]; rows: Row[]; wide?: boolean }) {
  return <div className={`${styles.table} ${wide ? styles.searchTable : ''}`}>
    <div className={styles.tableHeader}>{headers.map((header) => <span key={header}>{header}</span>)}</div>
    {rows.map((row, index) => <div className={styles.tableRow} key={`${row[0]?.text}-${index}`}>{row.map((cell, cellIndex) => (
      <span key={`${cell.text}-${cellIndex}`} title={cell.text}>{cellIndex === row.length - 1
        ? <RowActions value={cell.text} />
        : <b className={cell.tone ? styles[cell.tone] : ''}>{cell.text}</b>}</span>
    ))}</div>)}
  </div>
}

function CsvDialog() {
  return <div className={styles.overlay} role="presentation"><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="csv-title">
    <header><h2 id="csv-title">CSVでタグを一括登録</h2><p>テンプレートCSVを使い、最大500件を登録前の確認画面で重複・形式エラーまで確認します。</p></header>
    <div className={styles.flow}><strong>登録の流れ</strong><span>1. テンプレートCSVを取得　 2. CSVを選択　 3. 重複・形式エラーを確認　 4. 登録</span></div>
    <label className={styles.fileField}><span>登録するCSV</span><button type="button">⇧　CSVファイルを選択　<small>UTF-8・最大500件</small></button></label>
    <div className={styles.info}><strong>登録前に確認します</strong><p>同名タグは新規作成せず、存在しないフォルダ名は未分類として表示します。確認画面から登録を確定します。</p></div>
    <footer><Button>キャンセル</Button><button type="button" className={styles.disabledButton} disabled>内容を確認する</button></footer>
  </section></div>
}

export default function FriendAttributesV4States({ state }: { state: FriendAttributesV4State }) {
  const active = state === 'csv' ? 'tags' : state
  const csvData: ScreenSpec = {
    nodeId: 'sJE2f',
    sourceNodeId: 'KPgel',
    description: 'タグ・情報欄・対応マーク・保存条件を、用途まで見ながら管理します。',
    primary: 'CSV操作',
    metrics: [
      { label: 'タグ数', value: '101件', note: '未使用 78件' },
      { label: '付与済み友だち', value: '5人', note: '1つ以上付与' },
      { label: '今月の付与', value: '78回', note: '手動・自動' },
      { label: '整理候補', value: '80件', note: '未使用・重複名' },
    ],
    guide: 'テンプレートCSVを使い、最大500件を登録前の確認画面で重複・形式エラーまで確認します。',
    filters: ['タグ名・用途で検索', '使用状態：すべて', '付与元：すべて'],
    headers: ['タグ', 'フォルダ', '付与人数', '自動付与のもと', '連動', '使用先', '登録日', '操作'],
    rows: [
      [{ text: 'EC顧客連携済み' }, { text: '購入' }, { text: '5人' }, { text: 'EC連携' }, { text: '本人+10・1.2倍' }, { text: '配信3・フォーム1' }, { text: '2026/01/11' }, { text: '編集　削除', tone: 'blue' }],
      [{ text: 'LINEログイン連携済み' }, { text: '会員' }, { text: '5人' }, { text: 'LINE Login' }, { text: '—' }, { text: 'シナリオ2' }, { text: '2026/01/13' }, { text: '編集　削除', tone: 'blue' }],
      [{ text: 'NEN会員' }, { text: '会員' }, { text: '5人' }, { text: '回答フォーム' }, { text: '本人+10・紹介+5' }, { text: '配信4' }, { text: '2026/01/13' }, { text: '編集　削除', tone: 'blue' }],
      [{ text: '商品到着確認対象' }, { text: '購入' }, { text: '3人' }, { text: 'EC購入' }, { text: '本人+3' }, { text: '自動応答1' }, { text: '2026/01/13' }, { text: '編集　削除', tone: 'blue' }],
    ],
  }
  const data: ScreenSpec = state === 'csv' ? csvData : screenData[state]

  return <div className={styles.screen} data-design-node={data.nodeId} data-design-source-node={data.sourceNodeId} data-design-version="friend-attributes-v4-states">
    <header className={styles.header}><div><h1>友だち属性</h1><p>{data.description}</p></div><div><Button>マニュアル</Button><Button primary>{data.primary}</Button></div></header>
    <Tabs active={active} />
    <Metrics metrics={data.metrics} />
    <p className={styles.guide}>{data.guide}</p>
    <div className={styles.toolbar}><div>{data.filters.map((filter) => <Button key={filter}>{filter}</Button>)}</div><div>{data.secondaryAction && <Button>{data.secondaryAction}</Button>}<Button>{state === 'searches' ? '並び替え' : 'ドラッグで並び替え'}</Button><Button primary>{data.primary}</Button></div></div>
    <Table headers={data.headers} rows={data.rows} wide={state === 'searches' || state === 'csv'} />
    {data.safetyTitle && <section className={styles.safety}><strong>{data.safetyTitle}</strong><p>{data.safetyText}</p></section>}
    {state === 'searches' && <div className={styles.pagination}><Button>20件表示</Button><span>1〜20 / 12件</span><div className={styles.pageButtons} aria-label="ページ切替"><button type="button">前へ</button><button type="button" className={styles.currentPage}>1</button><button type="button">2</button><button type="button">3</button><span>…</span><button type="button">次へ</button></div></div>}
    {state === 'csv' && <CsvDialog />}
  </div>
}
