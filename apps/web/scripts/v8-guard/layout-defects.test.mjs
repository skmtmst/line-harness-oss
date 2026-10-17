import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { connectGuardBrowser } from './browser-session.mjs'
import { assess, assessAgainstBase, measurePage } from './layout-defects.mjs'
import scanPanelBlank from './panel-blank-browser.mjs'
import scanBlankGap from './blank-gap-browser.mjs'
const shell = body => '<style>*{box-sizing:border-box}body{margin:0;font:16px/20px sans-serif}main{width:1000px}</style><main>'+body+'</main>'

test('horizontal blank runs stay inside a semantic section; a real tall blank in that section still fails', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const section = (name, height) => `<section data-template-region="${name}" style="height:${height}px;width:1000px"><span style="display:block;width:760px;height:${height}px;background:#fafafa">内容</span></section>`
    await page.setContent(shell(section('heading',80)+section('stats',116)+'<footer style="height:40px;width:1000px;background:#eee">続き</footer>'))
    assert.ok(!(await page.evaluate(scanBlankGap)).findings.some(f => f.kind === 'horizontal' && !f.excluded))
    await page.setContent(shell(section('stats',320)+'<footer style="height:40px;width:1000px;background:#eee">続き</footer>'))
    assert.ok((await page.evaluate(scanBlankGap)).findings.some(f => f.kind === 'horizontal' && f.excess >= 96 && !f.excluded))
  } finally { await browser.close() }
})
const cases = {
  'control-overlap': '<div data-list-row style="display:flex"><button style="width:100px;height:36px">コピー</button><button style="width:36px;height:36px;margin-left:-30px">…</button></div>',
  'control-blocked': '<div data-list-row style="position:relative"><button style="width:80px;height:36px">…</button><span style="position:absolute;left:20px;top:0;width:36px;height:36px;background:#fff"></span></div>',
  wrap: '<span style="display:block;width:50px">短い名前の折り返し</span>',
  squash: '<button style="width:24px;word-break:break-all">20件表示</button>',
  clip: '<div style="overflow:hidden;width:100px"><span style="white-space:nowrap">横にはみ出した短い文字列です</span></div>',
  overlap: '<div style="position:relative"><span style="display:inline-block;width:120px">隣と重なる文字</span><span style="margin-left:-90px">重なった隣の文字</span></div>',
  'blank-vertical': '<div style="background:#fafafa;padding:24px"><p>上の中身</p><div style="height:240px"></div><p>下の中身</p></div>',
  'blank-horizontal': '<section style="width:240px;height:320px;background:#fafafa"><p>本文</p></section><footer style="height:40px;background:#eee">保存</footer>',
  'blank-kpi': '<div data-kpi-strip style="display:flex">'+Array.from({length:3},()=>'<div data-kpi-presentation="card" style="min-height:160px;padding:16px"><p>件数</p><p>12</p></div>').join('')+'</div>',
  blank: '<section style="width:300px;height:300px;border:1px solid"><p>中身</p></section><footer style="margin-top:900px">画面の続き</footer>',
}
const repairs = {
  'control-overlap': cases['control-overlap'].replace('margin-left:-30px', 'margin-left:16px'),
  'control-blocked': cases['control-blocked'].replace('left:20px', 'left:120px'),
  wrap: cases.wrap.replace('width:50px','width:300px;white-space:nowrap'),
  squash: cases.squash.replace('width:24px;word-break:break-all','width:100px;white-space:nowrap'),
  clip: cases.clip.replace('overflow:hidden;width:100px','overflow:visible;width:500px'),
  overlap: cases.overlap.replace('margin-left:-90px','margin-left:16px'),
  blank: cases.blank.replace('height:300px','height:auto').replace('margin-top:900px','margin-top:16px'),
  'blank-vertical': cases['blank-vertical'].replace('height:240px','height:16px'),
  'blank-horizontal': cases['blank-horizontal'].replace('width:240px','width:1000px').replace('height:320px','height:auto'),
  'blank-kpi': cases['blank-kpi'].replaceAll('min-height:160px','min-height:0'),
}
test('実物の表CSS：窓内のコンテナ幅を壊すと取消が押せず、修復後は押せる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const css = readFileSync(new URL('../../src/components/shared/data-table.module.css', import.meta.url), 'utf8')
    const html = style => `<html data-theme="v8"><style>${style}</style><body><div style="display:flex;flex-direction:column;align-items:flex-start;width:560px"><div class="frame" data-shared-part="list-table"><table class="table"><tbody><tr><td><button>取り消す</button></td></tr></tbody></table></div></div></body></html>`
    const hit = () => page.locator('button').evaluate(el => {
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    })
    await page.setContent(html(css.replace('width: 100%; min-width: 0; container-type: inline-size;', 'container-type: inline-size;')))
    assert.equal(await hit(), false, '幅の指定を外すと子の操作が隠れる')
    await page.setContent(html(css))
    assert.equal(await page.locator('.frame').evaluate(el => el.getBoundingClientRect().width), 560)
    assert.equal(await hit(), true, '実物CSSで取消の中央を押せる')
  } finally { await browser.close() }
})
test('入れ子のカードの余白は合算せず、カード自身の大きな余りは検出する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 1152, height: 900 } })
    const card = height => `<section data-design-part="card" style="background:white;padding:24px;${height}"><p style="margin:0;height:200px">内容</p></section>`
    const markup = inner => shell(`<div style="background:white;padding:24px"><section data-design-part="card" style="background:white;padding:24px">${inner}</section></div><footer style="margin-top:900px">続き</footer>`)
    await page.setContent(markup(card('')))
    assert.deepEqual(await page.evaluate(scanPanelBlank), [])
    await page.setContent(markup(card('height:360px')))
    const failures = await page.evaluate(scanPanelBlank)
    assert.equal(failures.length, 1)
    assert.equal(failures[0].measure.gap, 136)

  } finally { await browser.close() }
})
test('追従バーの裏の文字と、実際に見える重なりを区別する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 1152, height: 900 } })
    const covered = '<div style="height:200px;overflow:auto"><div style="height:300px">本文の文字</div><footer style="position:sticky;bottom:0;background:white;height:40px;z-index:2">保存の操作</footer></div>'
    // 追従した帯と本文を同じ位置へ置く。
    const fixture = covered.replace('height:300px', 'height:180px;padding-top:160px')
    await page.setContent(shell(fixture))
    assert.equal((await measurePage(page)).some(f => f.kind === 'overlap'), false)
    await page.locator('footer').evaluate(el => el.style.background = 'transparent')
    assert.ok((await measurePage(page)).some(f => f.kind === 'overlap'), '透明な帯では両方の文字が見える')
    await page.setContent(shell(fixture.replace('保存の操作', cases.overlap)))
    assert.ok((await measurePage(page)).some(f => f.kind === 'overlap'), '不透明な帯の中の重なりは検出する')
  } finally { await browser.close() }
})
test('種類ごとに実物を壊し、検出・終了コード1・修復後0を確認する', async () => {
  const browser = await connectGuardBrowser()
  const dir = mkdtempSync(join(tmpdir(),'v8-defects-'))
  try {
    const page = await browser.newPage({viewport:{width:1152,height:900}})
    for (const [kind, body] of Object.entries(cases)) {
      await page.setContent(shell(body))
      const findings = await measurePage(page)
      assert.ok(findings.some(f=>f.kind===kind),kind+' を検出する')
      assert.ok(assess(findings,'/fixture',1152,[]).failures.some(f=>f.kind===kind))
      await page.setContent(shell(repairs[kind]))
      assert.deepEqual(assess(await measurePage(page),'/fixture',1152,[]).failures,[],kind+'の修復')
    }
    await page.close()
  } finally { await browser.close() }
  try {
    // CLI 自身も種類別に止まる。起動は壊れた9枚で1回、修復9枚で1回。
    const fixture = join(dir,'test.html'), manifest = join(dir,'cases.json')
    writeFileSync(manifest,JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k,v])=>[k,shell(v)]))))
    const run = spawnSync(process.execPath,['apps/web/scripts/v8-guard/layout-defects.mjs','--fixtures',manifest],{encoding:'utf8',timeout:60000})
    assert.equal(run.status,1,run.stdout+run.stderr)
    for (const kind of Object.keys(cases)) {
      assert.match(run.stdout,new RegExp('崩れ 1152 /fixture/'+kind+': 新規[1-9]'))
      assert.match(run.stdout,new RegExp('  '+kind+' '))
    }
    writeFileSync(manifest,JSON.stringify(Object.fromEntries(Object.entries(repairs).map(([k,v])=>[k,shell(v)]))))
    const fixed = spawnSync(process.execPath,['apps/web/scripts/v8-guard/layout-defects.mjs','--fixtures',manifest],{encoding:'utf8',timeout:60000})
    assert.equal(fixed.status,0,fixed.stdout+fixed.stderr)
    for (const kind of Object.keys(cases)) assert.match(fixed.stdout,new RegExp('崩れ 1152 /fixture/'+kind+': 新規0'))
    writeFileSync(fixture,shell('<p>正常な一行</p>'))
    const good = spawnSync(process.execPath,['apps/web/scripts/v8-guard/layout-defects.mjs','--fixture',fixture],{encoding:'utf8',timeout:60000})
    assert.equal(good.status,0,good.stdout+good.stderr)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})
test('除外を実寸で確認し、表内の文字の重なりは見逃さない', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({viewport:{width:1152,height:900}})
    await page.setContent(shell('<aside data-template-region="folders">'+cases.wrap+'</aside><nav>'+cases.squash+'</nav><div data-line-preview-part="talk">'+cases.wrap+'</div><div style="display:flex;flex-direction:column"><div role="row" style="height:60px;border:1px solid">行1</div><div role="row" style="height:60px;border:1px solid">行2</div></div>'))
    assert.deepEqual(await measurePage(page),[])
    await page.setContent(shell('<div style="background:white;height:900px"><p style="margin:0">画面いっぱいの板</p></div>'))
    assert.deepEqual(await measurePage(page),[])
    await page.setContent(shell('<div role="row">'+cases.overlap+'</div>'))
    assert.ok((await measurePage(page)).some(f=>f.kind==='overlap'))
    await page.setContent(shell('<div style="width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="全文の名前">全文の名前が長い場合の省略</div>'))
    assert.equal((await measurePage(page)).some(f=>f.kind==='clip'),false)
    await page.setContent(shell('<div style="display:flex;gap:16px"><span style="width:80px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="長い名前の全文">長い名前が右の文字の裏まで続く省略</span><span>隣の名前</span></div>'))
    assert.equal((await measurePage(page)).some(f=>f.kind==='overlap'),false,'省略で隠れた文字は隣と重なっていない')
    await page.setContent(shell('<small style="display:block;width:120px">買うたびに数えます。売上を追うときに</small>'))
    assert.equal((await measurePage(page)).some(f=>f.kind==='wrap'),false,'説明文は短い名前の折り返しではない')
    await page.setContent(shell('<div style="overflow:hidden;width:100px"><span style="white-space:nowrap">省略なしで切れた長い名前を検出する</span></div>'))
    assert.ok((await measurePage(page)).some(f=>f.kind==='clip'),'隠れた重なりを除いても、省略なしの切れは検出する')
  } finally { await browser.close() }
})
test('ページ内タブの段は空白ではなく、空のタブ枠は引き続き検出する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 1152, height: 900 } })
    const tabs = '<nav><div role="tablist" style="height:156px">' + ['予約', '在庫', '休業'].map(name =>
      `<button role="tab" style="display:block;height:44px;margin-bottom:8px">${name}</button>`).join('') + '</div></nav>'
    const markup = inner => shell('<p style="margin:0">見出し</p>' + inner + '<p style="margin:0">本文</p>')
    await page.setContent(markup(tabs))
    assert.equal((await measurePage(page)).some(f => f.kind === 'blank-vertical'), false,
      'タブの文字と操作が占める段を空白と数えない')
    await page.setContent(markup('<nav><div role="tablist" style="height:156px"></div></nav>'))
    assert.ok((await measurePage(page)).some(f => f.kind === 'blank-vertical'),
      '中身のない高さだけの枠は空白として止める')
    await page.close()
  } finally { await browser.close() }
})
test('comparison retains every defect and never grants immunity to existing failures', () => {
  const defect = { kind: 'overlap', target: 'span', text: '本文', measure: { x: 10, y: 10 } }
  const result = assessAgainstBase([defect, defect], [defect])
  assert.deepEqual(result.failures, [defect, defect])
  assert.deepEqual(result.allowed, [])
  assert.deepEqual(result.existing, [])
  assert.deepEqual(assess([]).failures, [])
})
