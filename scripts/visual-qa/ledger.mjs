/**
 * 262画面の台帳を、`screens.mjs` と各機能の比較文書から組み立てる。
 *
 * **手で表を書き写さない。** 32機能ぶんを手で数えると必ずどこかで狂い、
 * 狂った数を根拠に「あと何枚」を話すことになる。台帳は `screens.mjs` を
 * 正本にして機械で出す。
 *
 *   node scripts/visual-qa/ledger.mjs            … 進捗台帳（Markdown）
 *   node scripts/visual-qa/ledger.mjs --json     … 集計値（JSON）
 *   node scripts/visual-qa/ledger.mjs --html     … v6-progress.html
 *
 * **3つとも同じ数から出す。** 表とJSONとページを別々に書くと、必ずどれかが
 * 古くなる。古い数を根拠に「あと何枚」を話すことになる。
 */
import { SCREENS, screensOf, CAPTURED_AT } from './screens.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 機能の名前。台帳の見出しに使う。 */
export const FEATURE_NAMES = {
  1: 'ダッシュボード', 2: '受信箱', 3: '友だち', 4: '友だち属性',
  5: 'シナリオ配信', 6: '一斉配信', 7: 'リマインダ', 8: '自動応答',
  9: '友だち追加時の配信', 10: 'ウェビナー', 11: 'テンプレート', 12: 'リッチメニュー',
  13: '回答フォーム', 14: '共通情報', 15: '登録メディア', 16: '成果とアフィリエイト',
  17: 'マイル・行動スコア', 18: '流入と計測', 19: 'コンバージョン', 20: '分析',
  21: 'NEN配信', 22: '写真審査', 23: 'EC連携', 24: 'LINE通知',
  25: 'オートメーション', 26: '外部連携', 27: '予約管理', 28: '予約設定',
  29: 'イベント予約', 30: 'ログインユーザー', 31: '機能設定', 32: '運用状態',
}

/**
 * 1枚の状態。**「撮れた」と「合っている」は別。**
 * 撮れたかどうかは画像の有無で分かるが、合っているかは比較文書だけが言える。
 */
/** 進捗ページ用。空欄は「まだPRのheadで撮り直していない」。 */
function capturedAtHtml(feature) {
  const at = CAPTURED_AT[feature]
  if (!at) return '<span class="none" title="まだ実装PRのheadで撮り直していません">—</span>'
  if (!at.head) return `<span class="hold">#${at.pr}<small>${esc(at.note ?? '保留')}</small></span>`
  return `<span class="pr">#${at.pr}</span><code>${at.head}</code>`
}

/** その機能をどのPRのheadで撮ったか。書いていなければ空欄。 */
function capturedAt(feature) {
  const at = CAPTURED_AT[feature]
  if (!at) return ''
  if (!at.head) return `#${at.pr}（${at.note ?? '保留'}）`
  return `#${at.pr} \`${at.head}\` ${at.on}`
}

function stateOf(screen) {
  if (screen.status === 'unimplemented') return 'unimplemented'
  if (screen.status === 'unconfirmed') return 'unconfirmed'
  if (screen.status === 'elsewhere') return 'elsewhere'
  const dir = join(ROOT, 'docs', 'design-qa', screen.dir)
  const names = screen.states
    ? screen.states.kinds.map((k) => `${screen.node}-${k}`)
    : [screen.node]
  const shot = names.every((n) => [1440, 1920].every((w) => existsSync(join(dir, `${n}-${w}.png`))))
  return shot ? 'compared' : 'missing'
}

const LABELS = {
  compared: '比較済み',
  unimplemented: '未実装',
  unconfirmed: '未確認',
  elsewhere: '別の仕掛けで撮影',
  missing: '未撮影',
}

function tally(list) {
  const out = { compared: 0, unimplemented: 0, unconfirmed: 0, elsewhere: 0, missing: 0 }
  for (const s of list) out[stateOf(s)] += 1
  return out
}

const features = Object.keys(FEATURE_NAMES).map(Number).sort((a, b) => a - b)
const rows = features.map((f) => {
  const list = screensOf(f)
  return { feature: f, name: FEATURE_NAMES[f], total: list.length, ...tally(list) }
})
const all = tally(SCREENS)

function esc(t) {
  return String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

if (process.argv.includes('--html')) {
  const pct = (n) => (SCREENS.length ? Math.round((n / SCREENS.length) * 1000) / 10 : 0)
  const bars = rows.map((r) => {
    const seg = (n, cls) => (n ? `<span class="${cls}" style="flex:${n}" title="${LABELS[cls]} ${n}"></span>` : '')
    return `      <tr>
        <th scope="row"><span class="num">${r.feature}</span>${esc(r.name)}</th>
        <td class="bar"><div class="track">${seg(r.compared, 'compared')}${seg(r.elsewhere, 'elsewhere')}${seg(r.unconfirmed, 'unconfirmed')}${seg(r.unimplemented, 'unimplemented')}${seg(r.missing, 'missing')}</div></td>
        <td class="n">${r.total}</td><td class="n ok">${r.compared}</td>
        <td class="n">${r.unimplemented || '—'}</td><td class="n">${r.unconfirmed || '—'}</td>
        <td class="n">${r.elsewhere || '—'}</td><td class="n">${r.missing || '—'}</td>
        <td class="at">${capturedAtHtml(r.feature)}</td>
      </tr>`
  }).join('\n')
  console.log(`<!-- scripts/visual-qa/ledger.mjs --html が作ります。手で直さないでください。 -->
<!-- 文字の指定を落とすと、ローカルで開いたときに日本語が全部化けます。 -->
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>V6 画面比較の進捗</title>
<style>
  :root {
    --ground: #f7f7f5; --card: #ffffff; --ink: #1a1a19; --ink-2: #55554f;
    --line: #e3e3de; --ok: #2f7d5b; --warn: #b8862f; --gap: #b4483c; --mute: #c9c9c2;
  }
  :root:not([data-theme="light"]) { }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #17171a; --card: #202024; --ink: #f2f2ef; --ink-2: #a8a8a1;
      --line: #33333a; --ok: #62b98d; --warn: #d8ac5d; --gap: #e07a6d; --mute: #4a4a52;
    }
  }
  :root[data-theme="dark"] {
    --ground: #17171a; --card: #202024; --ink: #f2f2ef; --ink-2: #a8a8a1;
    --line: #33333a; --ok: #62b98d; --warn: #d8ac5d; --gap: #e07a6d; --mute: #4a4a52;
  }
  body {
    background: var(--ground); color: var(--ink); margin: 0;
    font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
    line-height: 1.7; padding: 40px 20px;
  }
  main { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }
  h1 { font-size: 1.6rem; margin: 0; letter-spacing: .01em; text-wrap: balance; }
  .lede { color: var(--ink-2); margin: 0; font-size: .95rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; }
  .card b { display: block; font-size: 1.9rem; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .card span { color: var(--ink-2); font-size: .8rem; }
  .card.ok b { color: var(--ok); }
  .card.gap b { color: var(--gap); }
  .wrap { overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
  table { border-collapse: collapse; width: 100%; min-width: 760px; font-size: .88rem; }
  th, td { padding: 9px 12px; border-bottom: 1px solid var(--line); text-align: left; }
  thead th { color: var(--ink-2); font-weight: 600; font-size: .78rem; white-space: nowrap; }
  tbody th { font-weight: 600; white-space: nowrap; }
  .num { display: inline-block; width: 2em; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .n.ok { color: var(--ok); font-weight: 700; }
  .bar { width: 34%; min-width: 150px; }
  .track { display: flex; height: 9px; border-radius: 5px; overflow: hidden; background: var(--mute); }
  .compared { background: var(--ok); } .elsewhere { background: var(--ok); opacity: .55; }
  .unconfirmed { background: var(--warn); } .unimplemented { background: var(--gap); }
  .missing { background: var(--mute); }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; color: var(--ink-2); font-size: .8rem; margin: 0; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  footer { color: var(--ink-2); font-size: .8rem; }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
  td.at { font-size: 12px; color: var(--ink-2); white-space: nowrap; }
  td.at code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  td.at .pr { color: var(--ok); font-weight: 600; margin-right: .35em; }
  td.at .none { color: var(--mute); }
  td.at .hold { color: var(--warn); }
  td.at .hold small { display: block; font-size: 10px; color: var(--ink-2); }
</style>
<main>
  <header>
    <h1>V6 画面比較の進捗</h1>
    <p class="lede">Pencil の設計 262 画面を、1440px と 1920px の実装画像と並べた結果です。<strong>未実装を合格として数えていません。</strong></p>
  </header>

  <section class="cards">
    <div class="card"><b>${SCREENS.length}</b><span>画面の総数</span></div>
    <div class="card ok"><b>${all.compared}</b><span>比較済み（${pct(all.compared)}%）</span></div>
    <div class="card gap"><b>${all.unimplemented}</b><span>未実装</span></div>
    <div class="card"><b>${all.unconfirmed}</b><span>未確認</span></div>
    <div class="card"><b>${all.elsewhere}</b><span>別の仕掛けで撮影</span></div>
  </section>

  <p class="legend">
    <span><i class="compared"></i>比較済み</span>
    <span><i class="elsewhere"></i>別の仕掛けで撮影</span>
    <span><i class="unconfirmed"></i>未確認</span>
    <span><i class="unimplemented"></i>未実装</span>
    <span><i class="missing"></i>未撮影</span>
  </p>

  <div class="wrap">
    <table>
      <thead><tr>
        <th scope="col">機能</th><th scope="col">内訳</th><th scope="col" class="n">総数</th>
        <th scope="col" class="n">比較済み</th><th scope="col" class="n">未実装</th>
        <th scope="col" class="n">未確認</th><th scope="col" class="n">別仕掛け</th><th scope="col" class="n">未撮影</th><th scope="col">撮った先</th>
      </tr></thead>
      <tbody>
${bars}
      </tbody>
    </table>
  </div>

  <footer>
    <code>scripts/visual-qa/ledger.mjs --html</code> が <code>scripts/visual-qa/screens.mjs</code> から作ります。
    手で直すと、表と台帳とJSONがずれます。
  </footer>
</main>`)
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    generatedFrom: 'scripts/visual-qa/screens.mjs',
    total: SCREENS.length,
    ...all,
    features: rows.map((r) => ({ ...r, capturedAt: CAPTURED_AT[r.feature] ?? null })),
  }, null, 2))
} else {
  console.log('# V6 進捗台帳（262画面）\n')
  console.log('`scripts/visual-qa/screens.mjs` から機械で組み立てています。**手で書き写していません。**\n')
  console.log(`総数 **${SCREENS.length}** ／ 比較済み **${all.compared}** ／ 未実装 **${all.unimplemented}** ／ 未確認 **${all.unconfirmed}** ／ 別の仕掛けで撮影 **${all.elsewhere}** ／ 未撮影 **${all.missing}**\n`)
  console.log('| 機能 | 名前 | 総数 | 比較済み | 未実装 | 未確認 | 別の仕掛け | 未撮影 | 撮った先 |')
  console.log('|---|---|---|---|---|---|---|---|---|')
  for (const r of rows) {
    console.log(`| ${r.feature} | ${r.name} | ${r.total} | ${r.compared} | ${r.unimplemented} | ${r.unconfirmed} | ${r.elsewhere} | ${r.missing} | ${capturedAt(r.feature)} |`)
  }
  console.log(`| | **合計** | **${SCREENS.length}** | **${all.compared}** | **${all.unimplemented}** | **${all.unconfirmed}** | **${all.elsewhere}** | **${all.missing}** | |`)
  console.log('\n**「撮った先」が空**の機能は、まだ実装PRのheadで撮り直していません（自分の枝で撮ったものです）。**空欄を確認済みと読まないでください。**')
}
