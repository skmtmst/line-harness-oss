import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// @ts-expect-error 点検の道具は素のJSで型定義を持たない。
import { DEFAULT_CATALOG, hardcodedKind, judgePenInstances, loadCatalog, newCodeFindings, penNodes, run, scanPenBoard, stripThemeScope } from './v8-pattern-audit.mjs'

const ROOT = join(__dirname, '../..')

function put(root: string, rel: string, body: string) {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}

/** 小さな作りものの repo と板で、当たるべき所・当たってはいけない所を確かめる。 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pattern-audit-'))
  put(root, 'apps/liff/src/App.tsx', 'export default function App() { return null }')
  // (a) 手書きの数のマス（当たる）／コメントの中の名前（当たらない）
  put(root, 'apps/web/src/v8/demo/list.tsx', [
    "import styles from './list.module.css'",
    "import { Button } from '@/components/shared/button'",
    '// function StatCard は昔の名前（コメントは数えない）',
    'function StatCard() { return <div /> }',
    'export function List() {',
    '  return (',
    '    <section>',
    '      <Button',
    '        variant="primary"',
    '        className={styles.loud}',
    '      >作る</Button>',
    '      <Button className={styles.wide}>幅だけ</Button>',
    '    </section>',
    '  )',
    '}',
  ].join('\n'))
  // (a) 線だけのカード（当たる）／正しいカード（当たらない）。(b) 子孫の button の塗り直し。(c) 直書きの色・角丸
  put(root, 'apps/web/src/v8/demo/list.module.css', [
    '.box { border: 1px solid var(--color-hairline); border-radius: var(--radius-card); }',
    '.good { border: 1px solid var(--card-edge); border-radius: var(--radius-card); box-shadow: var(--card-shadow); }',
    '.loud { background: #ff0000; }',
    '.wide { width: 320px; }',
    ":global([data-theme='v8']) .wrap { display: flex; }",
    '.wrap button { color: var(--color-ink); border-radius: 6px; }',
  ].join('\n'))
  // 持ち主の中は (a)(b)(c) に数えない
  put(root, 'apps/web/src/components/shared/kpi-card.tsx', 'export function KpiCard() { return null }\nfunction StatCard() { return null }\n')
  put(root, 'apps/web/src/components/shared/card.module.css', '.card { border: 1px solid #dadde2; border-radius: 12px; }\n')
  // 試験のファイルは数えない
  put(root, 'apps/web/src/v8/demo/list.test.tsx', 'function StatCard() { return null }\n')
  // KpiBand を使う画面（効く範囲）
  put(root, 'apps/web/src/v8/other/page.tsx', "import { KpiBand } from '@/components/shared/kpi-band'\nexport const P = () => <KpiBand items={[]} />\n")

  const pen = join(root, 'pen')
  const button = (style: string, inner = '<div data-pencil-name="文字" style="">作る</div>') => `<div data-pencil-name="ボタン/主" style="${style}">${inner}</div>`
  const base = 'background-color: #087a3e; border-radius: 8px'
  put(pen, 'components-q4UhqD.html', `<div data-pencil-name="部品" data-pencil-id="root">${'<div data-pencil-name="ボタン/主" data-pencil-id="doYdE" style="background-color: #087a3e; border-radius: 8px"><div data-pencil-name="文字">作る</div></div>'}</div>`)
  const boards = ['B1', 'B2', 'B3', 'B4', 'B5']
  for (const b of boards) put(pen, `${b}.html`, `<div data-pencil-name="板 ${b}" style="">${button(base)}</div>`)
  // 文字だけ違う写し・中身の差し込み口（空き・数字を含む名前）は数えない・角丸を上書き（数える）・部品に無い中身（数える）
  put(pen, 'B6.html', `<div data-pencil-name="板 B6" style="">${button(base, '<div data-pencil-name="文字">別の言葉</div><div data-pencil-name="列 名前 2"></div>')}</div>`)
  put(pen, 'B7.html', `<div data-pencil-name="板 B7" style="">${button('background-color: #087a3e; border-radius: 4px')}</div>`)
  put(pen, 'B8.html', `<div data-pencil-name="板 B8" style="">${button(base, '<div data-pencil-name="文字">作る</div><div data-pencil-name="手で足した印"></div>')}</div>`)
  // 手描きのカード（白地・角丸12・線だけ）と、影のあるカード（数えない）
  put(pen, 'B9.html', '<div data-pencil-name="板 B9" style=""><div data-pencil-name="箱" style="background-color: #ffffff; border-radius: 12px; outline: 1px solid #1d1d1f12"></div><div data-pencil-name="箱2" style="background-color: #ffffff; border-radius: 12px; outline: 1px solid #1d1d1f12; box-shadow: 0px 1px 1px #1d1d1f29, 0px 2px 4px #1d1d1f14"></div></div>')
  return { root, pen }
}

describe('型の対応表の点検', () => {
  it('CLIはbaseとの比較で違反を拒否し、行移動と持ち主への委譲は許可する', () => {
    const { root, pen } = fixture()
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=Pattern Test', '-c', 'user.email=pattern-test@example.invalid', 'commit', '-qm', 'baseline'], { cwd: root })
    const script = join(ROOT, 'scripts/visual-qa/v8-pattern-audit.mjs')
    const audit = () => spawnSync(process.execPath, [script, '--code', root, '--base', 'HEAD', '--out', join(root, 'audit')], { encoding: 'utf8' })
    const rel = 'apps/web/src/v8/other/page.tsx'
    const good = readFileSync(join(root, rel), 'utf8')
    put(root, rel, `\n\n${good}`)
    expect(audit().status).toBe(0)
    // 正しい帯を1つ使っていても、隣に手書きした帯を見逃さない。
    put(root, rel, `${good}\nexport const Example = () => <><ReadOnlyNotice /><p className={styles.viewerBand}>閲覧のみで見ています</p></>\n`)
    expect(audit().status).toBe(1)
    put(root, rel, `${good}\nexport const Example = () => <p className={styles.readOnly}>閲覧のみで見ています</p>\n`)
    expect(audit().status).toBe(1)
    put(root, rel, `${good}\nexport const Example = () => <p className={styles.readonly}>閲覧のみで見ています</p>\n`)
    expect(audit().status).toBe(1)
    put(root, rel, `${good}\nexport const Example = () => <ReadOnlyNotice />\n`)
    expect(audit().status).toBe(0)
    put(root, rel, `${good}\nexport const Warning = () => <Notice tone="warn" role="alert">制約があります</Notice>\n`)
    expect(audit().status).toBe(0)
    put(root, rel, `${good}\nexport const Warning = () => <><Notice tone="warn" role="alert">制約があります</Notice><p role="alert">失敗しました</p></>\n`)
    expect(audit().status).toBe(1)
    put(root, rel, good)
    put(root, 'apps/web/src/v8/other/new.module.css', '.bad { color: #ff0000; border-radius: 7px; }')
    expect(audit().status).toBe(1)
  })
  it('行の移動は通し、手書き・上書き・直書きの新規と同じ候補の増殖は止める', () => {
    const hit = { file: 'apps/web/src/v8/demo/list.tsx', line: 3, scope: 'v8', signal: 'own-stat', text: 'function StatCard() {}' }
    const before = { code: { a: { 'kpi-band': [hit] }, b: {}, c: {} } }
    expect(newCodeFindings(before, { code: { a: { 'kpi-band': [{ ...hit, line: 30 }] } } })).toEqual([])
    const additions = [
      { ...hit, line: 40 },
      { ...hit, file: 'apps/web/src/v8/other/list.tsx' },
    ]
    const after = { code: {
      a: { 'kpi-band': [hit, ...additions] },
      b: { 'primary-button': [{ ...hit, kind: 'prop:className', text: '<Button className={styles.loud} />' }] },
      c: { card: [{ ...hit, kind: 'radius', text: '.card { border-radius: 7px }' }] },
    } }
    expect(newCodeFindings(before, after).map((h: { category: string }) => h.category)).toEqual(['a', 'a', 'b', 'c'])
  })

  it('見張りが実際の壊し方で止まる（正しい部品へ戻すと通る）', () => {
    const { root, pen } = fixture()
    const before = run({ code: root, pen })
    const rel = 'apps/web/src/v8/other/page.tsx'
    const good = readFileSync(join(root, rel), 'utf8')
    put(root, rel, `${good}\nfunction StatCard() { return <div /> }\n`)
    expect(newCodeFindings(before, run({ code: root, pen })).some((h: { category: string; file: string }) => h.category === 'a' && h.file === rel)).toBe(true)
    put(root, rel, good)
    expect(newCodeFindings(before, run({ code: root, pen }))).toEqual([])
  })
  it('対応表の正規表現が全部読め、持ち主のファイルがこの repo にある', () => {
    const catalog = loadCatalog(DEFAULT_CATALOG)
    expect(catalog.patterns.length).toBeGreaterThanOrEqual(34)
    const ids = catalog.patterns.map((p: { id: string }) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const pattern of catalog.patterns) {
      for (const file of pattern.owner?.code?.files ?? []) expect(existsSync(join(ROOT, file)), `${pattern.id}: ${file}`).toBe(true)
      for (const test of pattern.guard?.tests ?? []) expect(existsSync(join(ROOT, test)), `${pattern.id}: ${test}`).toBe(true)
      expect(pattern.rules.length, pattern.id).toBeGreaterThan(0)
    }
  })

  it('(a) 手書きを拾い、コメント・試験・持ち主の中は拾わない', () => {
    const { root, pen } = fixture()
    const report = run({ code: root, pen, only: ['kpi-band', 'card', 'primary-button'] })
    const kpi = report.code.a['kpi-band']
    expect(kpi.map((h: { file: string; line: number }) => `${h.file}:${h.line}`)).toEqual(['apps/web/src/v8/demo/list.tsx:4'])
    const card = report.code.a.card.map((h: { file: string; line: number }) => `${h.file}:${h.line}`)
    expect(card).toEqual(['apps/web/src/v8/demo/list.module.css:1'])
    // 効く範囲：KpiBand を読む画面は1ファイル
    expect(report.summary.find((r: { id: string }) => r.id === 'kpi-band').reach.codeFiles).toBe(1)
  })

  it('(b) 見た目を足す className と子孫の塗り直しだけを拾い、幅だけの className と見た目の範囲指定は拾わない', () => {
    const { root, pen } = fixture()
    const report = run({ code: root, pen, only: ['primary-button'] })
    const props = report.code.b['primary-button'].filter((h: { kind: string }) => h.kind.startsWith('prop:'))
    expect(props.map((h: { line: number }) => h.line)).toEqual([10])
    const css = report.code.b['primary-button'].filter((h: { kind: string }) => h.kind === 'css')
    expect(css.map((h: { text: string }) => h.text)).toEqual(['.wrap button'])
    expect(stripThemeScope(":global([data-theme='v8']) .wrap")).toBe('.wrap')
  })

  it('(c) 変数を読まない色・角丸を拾い、var() と 0 は拾わない', () => {
    expect(hardcodedKind('background', '#ff0000')).toBe('color')
    expect(hardcodedKind('color', 'var(--color-ink, #111)')).toBeNull()
    expect(hardcodedKind('border-radius', '6px')).toBe('radius')
    expect(hardcodedKind('border-radius', '0')).toBeNull()
    expect(hardcodedKind('box-shadow', 'var(--card-shadow)')).toBeNull()
    expect(hardcodedKind('width', '100%')).toBeNull()
    const { root, pen } = fixture()
    const report = run({ code: root, pen, only: ['primary-button'] })
    const all = Object.values(report.code.c).flat() as { file: string; kind: string }[]
    expect(all.every((h) => !h.file.includes('components/shared/'))).toBe(true)
    expect(all.filter((h) => h.file.endsWith('list.module.css')).map((h) => h.kind).sort()).toEqual(['color', 'radius', 'size'])
  })

  it('(d) Pen：角丸の上書きと手で足した中身を拾い、文字だけの違いは拾わない。手描きのカードは影の無いものだけ', () => {
    const { root, pen } = fixture()
    const report = run({ code: root, pen, only: ['primary-button', 'card'] })
    const inst = report.pen.inst['primary-button'].map((h: { board: string; kind: string }) => `${h.board}:${h.kind}`).sort()
    expect(inst).toEqual(['B7:pen:look', 'B8:pen:detached'])
    expect(report.summary.find((r: { id: string }) => r.id === 'primary-button').reach.penBoards).toBe(8)
    expect(report.pen.hand.card.map((h: { board: string; name: string }) => `${h.board}:${h.name}`)).toEqual(['B9:箱'])
  })

  it('板の html の入れ子を読み、祖先で除ける', () => {
    const nodes = penNodes('<div data-pencil-name="左メニュー"><div data-pencil-name="箱" style="background-color: #ffffff; border-radius: 12px; outline: 1px solid #000"></div></div>')
    expect(nodes[1].ancestors).toEqual(['左メニュー'])
    expect(nodes[0].end).toBe(2)
    const catalog = loadCatalog(DEFAULT_CATALOG)
    const card = catalog.patterns.find((p: { id: string }) => p.id === 'card')
    expect(scanPenBoard(card, 'X', nodes)).toEqual([])
    expect(judgePenInstances([], ['border-radius'])).toEqual([])
    expect(readFileSync(DEFAULT_CATALOG, 'utf8')).toContain('"owner"')
  })
})
