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
 *   node scripts/visual-qa/ledger.mjs --gaps     … 未実装の片づけ方（Markdown）
 *
 * **3つとも同じ数から出す。** 表とJSONとページを別々に書くと、必ずどれかが
 * 古くなる。古い数を根拠に「あと何枚」を話すことになる。
 */
import { SCREENS, screensOf, CAPTURED_AT, WIDTHS } from './screens.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** `capture.spec.mjs` が置く基準画像。`elsewhere` の絵はここに在る。 */
const SNAPSHOTS = join(ROOT, 'scripts', 'visual-qa', 'capture.spec.mjs-snapshots')

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
  /*
    pen が §7 #28・#29 で足した2機能（台帳 kentavndng/line-harness-board#18）。
    **ここに書かないと台帳から静かに落ちる**——この表の鍵だけを回しているので、
    名前の無い機能は数にも入らない。
  */
  33: 'LINEアカウント設定', 34: 'はじめの設定と案内',
}

/**
 * 1枚の状態。**「撮れた」と「合っている」は別。**
 * 撮れたかどうかは画像の有無で分かるが、合っているかは比較文書だけが言える。
 */
/** 進捗ページ用。空欄は「まだPRのheadで撮り直していない」。 */
function capturedAtHtml(feature) {
  const list = CAPTURED_AT[feature]
  if (!list) return '<span class="none" title="まだ実装PRのheadで撮り直していません">—</span>'
  return list.map((at) => (at.head
    ? `<span class="pr">#${at.pr}</span><code>${at.head}</code>${at.screens ? `<small>${esc(at.screens.join('・'))}</small>` : ''}`
    : `<span class="hold">#${at.pr}<small>${esc(at.note ?? '保留')}</small></span>`)).join('<br>')
}

/** その機能をどのPRのheadで撮ったか。書いていなければ空欄。 */
function capturedAt(feature) {
  const list = CAPTURED_AT[feature]
  if (!list) return ''
  return list.map((at) => (at.head
    ? `#${at.pr} \`${at.head}\` ${at.on}${at.screens ? `（${at.screens.join('・')}）` : ''}`
    : `#${at.pr}（${at.note ?? '保留'}）`)).join('<br>')
}

function stateOf(screen) {
  if (screen.status === 'unimplemented') return 'unimplemented'
  if (screen.status === 'unconfirmed') return 'unconfirmed'
  if (screen.status === 'elsewhere') {
    /*
      **在ると言うだけでは数えない。** `shots` に書いた基準画像が
      1440・1920 の両方そろっているかを見る。片方でも無ければ `missing`。
      名前を書いただけで数えると、見ていないものが「撮ってある」列に入る。
    */
    if (!screen.shots) return 'missing'
    const ok = WIDTHS.every((w) => existsSync(join(SNAPSHOTS, `${screen.shots}-${w}-darwin.png`)))
    return ok ? 'elsewhere' : 'missing'
  }
  /*
    画像を本流へ全件コピーしなくても、**どの実装headで判定したか**を
    Nodeごとに残していれば比較済みと数えられる。画像の有無だけを見ると、
    証拠を保管用ブランチへ退避しただけで247件が未撮影へ戻ってしまう。

    verdictだけでは足りない。verdictHeadも必須にし、見ていない判定を
    「比較済み」と数えない。
  */
  if (screen.verdict && screen.verdictHead) return 'compared'
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
  /*
    **帯は「撮れたか」ではなく「合っていたか」で塗る。**
    撮れた数で塗ると、要修正が161枚あっても帯は緑一色になり、
    **もうすぐ終わりに見える。**
  */
  vMatch: '一致',
  vStructure: '構造一致・データ未接続',
  vNeedsFix: '要修正',
  vUnimplemented: '未実装',
  vUnjudged: '未判定',
}

function tally(list) {
  const out = {
    compared: 0, unimplemented: 0, unconfirmed: 0, elsewhere: 0, missing: 0,
    /* 判定の内訳。**「撮れた」と「合っていた」は別に数える。** */
    match: 0, structureMatchDataPending: 0, needsFix: 0, unjudged: 0,
  }
  const VERDICT_KEY = {
    match: 'match',
    structure_match_data_pending: 'structureMatchDataPending',
    needs_fix: 'needsFix',
  }
  for (const s of list) {
    out[stateOf(s)] += 1
    if (s.status) continue
    /* **空欄を一致として数えない。** 判定が無ければ「未判定」。 */
    const key = VERDICT_KEY[s.verdict]
    if (key) out[key] += 1
    else out.unjudged += 1
  }
  /* **完了まで残り。** 一致以外の全部。 */
  out.remaining = out.structureMatchDataPending + out.needsFix + out.unimplemented + out.unjudged
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
        <td class="bar"><div class="track">${seg(r.match, 'vMatch')}${seg(r.structureMatchDataPending, 'vStructure')}${seg(r.needsFix, 'vNeedsFix')}${seg(r.unimplemented, 'vUnimplemented')}${seg(r.unjudged, 'vUnjudged')}</div></td>
        <td class="n">${r.total}</td><td class="n ok">${r.match || '—'}</td>
        <td class="n">${r.structureMatchDataPending || '—'}</td><td class="n">${r.needsFix || '—'}</td>
        <td class="n">${r.unimplemented || '—'}</td><td class="n">${r.unjudged || '—'}</td>
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
  .vMatch { background: var(--ok); } .vStructure { background: var(--warn); opacity: .55; }
  .vNeedsFix { background: var(--warn); } .vUnimplemented { background: var(--gap); }
  .vUnjudged { background: var(--mute); }
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
    <p class="lede">Pencil の設計 262 画面を、1440px と 1920px の実装画像と並べた結果です。<strong>帯は「撮れたか」ではなく「合っていたか」で塗っています。</strong>撮れた数で塗ると、要修正が何枚あっても帯は緑一色になります。</p>
  </header>

  <section class="cards">
    <div class="card"><b>${SCREENS.length}</b><span>画面の総数</span></div>
    <div class="card ok"><b>${all.compared}</b><span>比較済み（${pct(all.compared)}%）</span></div>
    <div class="card ok"><b>${all.match}</b><span>一致（${pct(all.match)}%）</span></div>
    <div class="card warn"><b>${all.structureMatchDataPending}</b><span>構造一致・データ未接続</span></div>
    <div class="card warn"><b>${all.needsFix}</b><span>要修正</span></div>
    <div class="card warn"><b>${all.unjudged}</b><span>未判定</span></div>
    <div class="card gap"><b>${all.remaining}</b><span>完了まで残り</span></div>
    <div class="card gap"><b>${all.unimplemented}</b><span>未実装</span></div>
    <div class="card"><b>${all.unconfirmed}</b><span>未確認</span></div>
    <div class="card"><b>${all.elsewhere}</b><span>別の仕掛けで撮影</span></div>
  </section>

  <p class="legend">
    <span><i class="vMatch"></i>一致</span>
    <span><i class="vStructure"></i>構造一致・データ未接続</span>
    <span><i class="vNeedsFix"></i>要修正</span>
    <span><i class="vUnimplemented"></i>未実装</span>
    <span><i class="vUnjudged"></i>未判定</span>
  </p>

  <div class="wrap">
    <table>
      <thead><tr>
        <th scope="col">機能</th><th scope="col">内訳</th><th scope="col" class="n">総数</th>
        <th scope="col" class="n">一致</th><th scope="col" class="n">構造一致<br>データ未接続</th>
        <th scope="col" class="n">要修正</th><th scope="col" class="n">未実装</th><th scope="col" class="n">未判定</th><th scope="col">撮った先</th>
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
} else if (process.argv.includes('--gaps')) {
  /*
    未実装をどう片づけるかの表。**`screens.mjs` の `gap` から出す。**
    手で書くと、実装が進んだときに古い分類だけが残る。
  */
  const KINDS = [
    ['parts', '既存部品で作れる', 'もうリポジトリに在るものを当てるだけ。`ConfirmDialog` `ListState` `Select` など'],
    ['build', '通常実装', '画面を新しく作る。**口（API）は既に在る**ので、つなぐだけ'],
    ['api', '新規API・DBが必要', '記録・集計・走らせる仕掛けが無い。**先に決めることがある**'],
    ['drop', 'V6から除外候補', '作らない決めがある、またはほかの画面に統合済み。**判断をお願いします**'],
    ['pending', 'Codex実装中・新PR待ち', '作っているところ。**headが届いたら撮ります**'],
  ]
  const un = SCREENS.filter((s) => s.status === 'unimplemented')
  console.log('# 未実装画面の片づけ方\n')
  console.log('`scripts/visual-qa/screens.mjs` の `gap` から機械で組み立てています。**手で書き写していません。**\n')
  console.log(`未実装 **${un.length}** 枚を片づけ方ごとに分けました。\n`)
  console.log('| 分け方 | 枚数 | 何を指すか |')
  console.log('|---|---|---|')
  for (const [key, label, desc] of KINDS) {
    /* **0件の分け方は出さない。** 空の行が残ると、まだ在るように読める。 */
    const n = un.filter((s) => s.gap === key).length
    if (n) console.log(`| **${label}** | ${n} | ${desc} |`)
  }
  const noGap = un.filter((s) => !s.gap)
  if (noGap.length) console.log(`| （未分類） | ${noGap.length} | ${noGap.map((s) => s.node).join('・')} |`)
  const order = [17, 20, 22]
  for (const [key, label, desc] of KINDS) {
    const rows = un.filter((s) => s.gap === key)
    if (!rows.length) continue
    console.log(`\n## ${label}（${rows.length}枚）\n`)
    console.log(`${desc}\n`)
    console.log('| 機能 | Node | 画面 | 何が要るか |')
    console.log('|---|---|---|---|')
    const feats = [...order, ...[...new Set(rows.map((r) => r.feature))].filter((f) => !order.includes(f)).sort((a, b) => a - b)]
    for (const f of feats) {
      for (const r of rows.filter((x) => x.feature === f)) {
        console.log(`| ${f} ${FEATURE_NAMES[f]} | \`${r.node}\` | ${r.name} | ${r.gapNote ?? '—'} |`)
      }
    }
  }
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    generatedFrom: 'scripts/visual-qa/screens.mjs',
    total: SCREENS.length,
    ...all,
    features: rows.map((r) => ({ ...r, capturedAt: CAPTURED_AT[r.feature] ?? null })),
    gaps: SCREENS.filter((s) => s.status === 'unimplemented').map((s) => ({
      feature: s.feature, node: s.node, name: s.name, gap: s.gap ?? null, gapNote: s.gapNote ?? null,
    })),
  }, null, 2))
} else {
  console.log('# V6 進捗台帳（262画面）\n')
  console.log('`scripts/visual-qa/screens.mjs` から機械で組み立てています。**手で書き写していません。**\n')
  console.log(`総数 **${SCREENS.length}** ／ 比較済み **${all.compared}** ／ 未実装 **${all.unimplemented}** ／ 未確認 **${all.unconfirmed}** ／ 別の仕掛けで撮影 **${all.elsewhere}** ／ 未撮影 **${all.missing}**\n`)

  console.log('## 判定\n')
  console.log('**「撮れた」と「合っていた」は別に数えます。** 空欄は一致にしません。\n')
  console.log('| 判定 | 数 |')
  console.log('|---|---|')
  console.log(`| 一致 | **${all.match}** |`)
  console.log(`| 構造一致・データ未接続 | ${all.structureMatchDataPending} |`)
  console.log(`| 要修正 | ${all.needsFix} |`)
  console.log(`| 未実装 | ${all.unimplemented} |`)
  console.log(`| 未判定 | ${all.unjudged} |`)
  console.log(`| **完了まで残り** | **${all.remaining}** |`)
  console.log('\n「完了まで残り」＝ 構造一致・データ未接続 ＋ 要修正 ＋ 未実装 ＋ 未判定。\n')

  console.log('| 機能 | 名前 | 総数 | 比較済み | 一致 | 構造一致・データ未接続 | 要修正 | 未実装 | 未判定 | 未確認 | 別の仕掛け | 未撮影 | 撮った先 |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of rows) {
    console.log(`| ${r.feature} | ${r.name} | ${r.total} | ${r.compared} | ${r.match} | ${r.structureMatchDataPending} | ${r.needsFix} | ${r.unimplemented} | ${r.unjudged} | ${r.unconfirmed} | ${r.elsewhere} | ${r.missing} | ${capturedAt(r.feature)} |`)
  }
  console.log(`| | **合計** | **${SCREENS.length}** | **${all.compared}** | **${all.match}** | **${all.structureMatchDataPending}** | **${all.needsFix}** | **${all.unimplemented}** | **${all.unjudged}** | **${all.unconfirmed}** | **${all.elsewhere}** | **${all.missing}** | |`)
  console.log('\n**「撮った先」が空**の機能は、まだ実装PRのheadで撮り直していません（自分の枝で撮ったものです）。**空欄を確認済みと読まないでください。**')
}
