import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { chromium } from '@playwright/test'
import { assess, assessAgainstBase, record, measurePage, identifyStableTargets, validateAllowances } from './layout-defects.mjs'
import scanPanelBlank from './panel-blank-browser.mjs'
import scanBlankGap from './blank-gap-browser.mjs'
const shell = body => '<style>*{box-sizing:border-box}body{margin:0;font:16px/20px sans-serif}main{width:1000px}</style><main>'+body+'</main>'

test('horizontal blank runs stay inside a semantic section; a real tall blank in that section still fails', async () => {
  const browser = await chromium.launch()
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
  touch: '<div style="display:flex;flex-direction:column"><section style="height:80px;border:1px solid">上の表</section><section style="height:80px;border:1px solid">下のカード</section></div>',
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
  touch: cases.touch.replace('flex-direction:column','flex-direction:column;gap:16px'),
  blank: cases.blank.replace('height:300px','height:auto').replace('margin-top:900px','margin-top:16px'),
  'blank-vertical': cases['blank-vertical'].replace('height:240px','height:16px'),
  'blank-horizontal': cases['blank-horizontal'].replace('width:240px','width:1000px').replace('height:320px','height:auto'),
  'blank-kpi': cases['blank-kpi'].replaceAll('min-height:160px','min-height:0'),
}
test('実物の表CSS：窓内のコンテナ幅を壊すと取消が押せず、修復後は押せる', async () => {
  const browser = await chromium.launch()
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
  const browser = await chromium.launch()
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
  const browser = await chromium.launch()
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
  const browser = await chromium.launch()
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
  const browser = await chromium.launch()
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
  const browser = await chromium.launch()
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
test('既存だけ許可し、新しい場所・幅・種類・文字・件数・悪化を止める',()=>{
  const f={kind:'wrap',target:'span.name',text:'既存の名前',measure:{lines:2}}
  const allow=record([f],'/friends',1152,'既存の名前の折り返し。B-191の画面担当が修正予定')
  assert.equal(assess([f],'/friends',1152,allow).failures.length,0)
  for (const newer of [{...f,target:'span.new'}, {...f,kind:'squash'},{...f,text:'別の名前'},{...f,measure:{lines:3}}]) assert.equal(assess([newer],'/friends',1152,allow).failures.length,1)
  assert.equal(assess([f,f],'/friends',1152,allow).failures.length,1)
  assert.equal(assess([f],'/friends',1440,allow).failures.length,1)
  assert.equal(assess([f],'/other',1152,allow).failures.length,1)
  const touch={...f,kind:'touch',measure:{gap:6}}
  const touching=record([touch],'/friends',1152,'既存のすき間不足')
  assert.equal(assess([{...touch,measure:{gap:2}}],'/friends',1152,touching).failures.length,1)
  assert.throws(()=>validateAllowances([{...allow[0],reason:''}]))
  assert.throws(()=>validateAllowances([allow[0],allow[0]]))
})

test('同じ検出器の統合先実測だけを土台にし、新規・件数増加・悪化は止める', () => {
  const f = {kind:'tight', target:'section.card', text:'本文', measure:{topDeficit:2, bottomDeficit:3}}
  const compare = findings => assessAgainstBase(findings, [f], '/friends', 1152)
  assert.equal(compare([f]).existing.length, 1)
  assert.deepEqual(compare([]).failures, [])
  for (const newer of [{...f,target:'section.other'}, {...f,kind:'cardbottom'}, {...f,text:'別の本文'}, {...f,measure:{topDeficit:2,bottomDeficit:4}}]) {
    assert.equal(compare([newer]).failures.length, 1)
  }
  assert.equal(compare([f,f]).failures.length, 1)
  const allow = record([f], '/friends', 1152, '固定の既存許可')
  assert.equal(assessAgainstBase([f,f], [f], '/friends', 1152, allow).failures.length, 1, '固定許可と土台を二重に足さない')
  assert.equal(assessAgainstBase([{...f,measure:{topDeficit:2,bottomDeficit:4}}], [{...f,measure:{topDeficit:2,bottomDeficit:8}}], '/friends',1152,allow).failures.length, 1, '固定許可の上限も書き換えない')
  const touch = {...f,kind:'touch',measure:{gap:6}}
  assert.equal(assessAgainstBase([{...touch,measure:{gap:2}}],[touch],'/friends',1152).failures.length,1)
  const empty = {...f,kind:'empty-blank-ok',measure:{count:1}}
  assert.equal(assessAgainstBase([empty],[empty],'/friends',1152).failures.length,1, '理由なしの除外は既存でも止める')
})

test('旧の非表示要素の削除は同じ外枠と照合し、増殖・別の子・実寸の悪化は止める', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const f = {kind:'blank-horizontal',target:'div.app-shell_workspace:nth-of-type(2) > p:nth-of-type(1)',text:'right',measure:{excess:156}}
    const identify = async (finding, markup) => {
      await page.setContent(markup)
      return (await page.evaluate(identifyStableTargets,[finding]))[0]
    }
    const base = await identify(f, '<div hidden></div><div class="app-shell_workspace__old"><p>本文</p></div>')
    const head = await identify({...f,target:f.target.replace('(2)','(1)')}, '<div class="app-shell_workspace__new"><p>本文</p></div>')
    const allow = record([f],'/fixture',1152,'既存の同じ場所')
    const assessHead = values => assessAgainstBase(values,[base],'/fixture',1152,allow)
    assert.equal(assessHead([head]).failures.length,0)
    assert.equal(assessHead([head,head]).failures.length,1)
    for (const change of [
      {...head,measure:{excess:157}}, {...head,text:'別の文字'},
      await identify({...head,target:head.target.replace('p:nth-of-type(1)','p:nth-of-type(2)')},'<div class="app-shell_workspace__new"><p>本文</p><p>別</p></div>'),
      await identify(head,'<div class="app-shell_workspace__new"><p>本文</p></div><div class="app-shell_workspace__other"><p>別</p></div>'),
    ]) assert.equal(assessHead([change]).failures.length,1)
    assert.equal(assessAgainstBase([head],[f],'/fixture',1152,allow).failures.length,1,'本線の実画面の証拠なしでは照合しない')
  } finally { await browser.close() }
})

test('CLIは新しい検出種類をbaseにも当て、既存は通すが新しい黒い箱とbaseの測定失敗は終了1', async () => {
  let baseBody = '<h2>題</h2>', headBody = baseBody, baseStatus = 200
  const dark = '<div style="background:#111;color:white;width:200px;height:36px">黒い札</div>'
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(shell(headBody))
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  const dir = mkdtempSync(join(tmpdir(),'v8-base-compare-'))
  try {
    const url = `http://127.0.0.1:${server.address().port}`
    const out = join(dir,'result.json')
    // 同じ/friendsを、それぞれの書き出しを配る別サーバーで開く。
    const baseServer = createServer((request, response) => {
      response.statusCode = baseStatus
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(shell(baseBody))
    })
    await new Promise(resolve => baseServer.listen(0,'127.0.0.1',resolve))
    const compareUrl = `http://127.0.0.1:${baseServer.address().port}`
    const runCompare = async () => {
      try {
        const result = await promisify(execFile)(process.execPath,['apps/web/scripts/v8-guard/layout-defects.mjs',url,out,'--compare-url',compareUrl,'--route','/friends'],{timeout:60000})
        return {status:0,...result}
      } catch (error) { return {status:error.code,stdout:error.stdout,stderr:error.stderr} }
    }
    try {
      headBody += dark
      assert.equal((await runCompare()).status,1)
      baseBody += dark
      assert.equal((await runCompare()).status,0)
      assert.equal(Object.values(JSON.parse(readFileSync(out,'utf8'))).every(r=>r.existing.some(f=>f.kind==='dark')),true)
      headBody += dark
      assert.equal((await runCompare()).status,1)
      baseBody = '<h2>画面を表示できませんでした</h2>'
      assert.equal((await runCompare()).status,1)
      const result = JSON.parse(readFileSync(out,'utf8'))
      assert.equal(Object.values(result).every(r=>r.error),true, JSON.stringify(result))
      baseStatus = 404
      baseBody = '<h2>見つかりません</h2>'
      assert.equal((await runCompare()).status,1)
      assert.equal(Object.values(JSON.parse(readFileSync(out,'utf8'))).every(r=>/HTTP.*404/.test(r.error)),true)
    } finally { await new Promise(resolve=>baseServer.close(resolve)) }
  } finally {
    await new Promise(resolve=>server.close(resolve))
    rmSync(dir,{recursive:true,force:true})
  }
})

test('空白検査はCIで一度だけ実行し、既存V8 guardと同じ必須扱い',()=>{
  const yaml = readFileSync('.github/workflows/required-pr-gate.yml','utf8')
  const job = yaml.split('  v8-screen-guard:')[1].split('  required-pr-gate:')[0]
  assert.equal((job.match(/run: node apps\/web\/scripts\/v8-guard\/layout-defects\.mjs /g)||[]).length,1)
  assert.doesNotMatch(job,/run:.*blank-gap\.mjs/,'blankfixの空白検査を別ステップで重ねない')
  const step=job.split('      - name:').find(step => step.includes('run: node apps/web/scripts/v8-guard/layout-defects.mjs'))
  assert.ok(step, '実画面の崩れ検査のステップが必要')
  assert.doesNotMatch(step,/continue-on-error/)
  assert.match(step,/steps.scope.outputs.run == 'true'/)
  assert.match(step,/--compare-url/)
  const baseBuild = job.split('      - name:').find(step => step.includes('Build the base admin'))
  assert.match(baseBuild,/steps.scope.outputs.compare == 'true'/)
  assert.doesNotMatch(baseBuild,/steps.scope.outputs.diff/,'v7の画素を飛ばしても崩れの土台を測る')
})

// P〜Sは実際のCSSの故障を検出する。許可や上限では通さない。
import scanFormRules from './form-rules-browser.mjs'
test('F組の色・左操作・任意・欄の右端を、正しい形と故障注入で守る', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const good = `<style>button{box-sizing:border-box} [role=radio]{width:24px;height:24px;border-radius:50%;border:0} [aria-checked=true]{outline:2px solid black} [data-sticky-lead] button{background:white;outline:1px solid gray} [data-form-row]{width:480px;display:grid;grid-template-columns:2fr 1fr;gap:12px} input{box-sizing:border-box;width:100%}</style><main>
      <div data-color-palette="inline" role="radiogroup"><button role="radio" aria-label="赤" aria-checked="true"></button><button role="radio" aria-label="青" aria-checked="false"></button></div>
      <div data-sticky-lead><div><button disabled>保管する<svg></svg></button><span role="note">使用先があるため保管できません</span></div></div>
      <h2>ひな形から作る <span aria-hidden="true">任意</span></h2>
      <div data-form-row="name-folder"><div><input aria-label="名前" /></div><div><input aria-label="フォルダ" /></div></div></main>`
    for (const width of [1440, 1152]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(good)
      assert.deepEqual(await page.evaluate(scanFormRules), [])
      const bad = good.replace('width:24px;height:24px', 'width:18px;height:18px').replace('outline:2px solid black', 'outline:none').replace('<span role="note">使用先があるため保管できません</span>', '').replace('<span aria-hidden="true">任意</span>', '（任意）').replace('width:100%', 'width:calc(100% - 48px)')
      await page.setContent(bad)
      const findings = await page.evaluate(scanFormRules)
      for (const kind of ['form-color', 'form-footer-action', 'form-optional', 'form-row-end']) assert.ok(findings.some(f => f.kind === kind), kind)
      assert.ok(findings.some(f => f.text === '選んだ色には輪を出す'))
      await page.setContent(good.replace('aria-checked="true"', 'aria-checked="false"'))
      assert.ok((await page.evaluate(scanFormRules)).some(f => f.text === '選んだ色を1つ表示する'))
      await page.setContent(good.replace('background:white', 'background:red').replace('<svg></svg>', ''))
      assert.ok((await page.evaluate(scanFormRules)).some(f => f.text === '左端の操作は印つき副ボタン'))
    }
  } finally { await browser.close() }
})
test('作る型の実CSS：1152は右欄を畳み名前とフォルダを1列、1440は2列', async () => {
  const { default: scanFormRules } = await import('./form-rules-browser.mjs')
  const rowCss = readFileSync(new URL('../../src/components/shared/settings-form-card.module.css', import.meta.url), 'utf8')
  const tplCss = readFileSync(new URL('../../src/components/templates/page-templates.module.css', import.meta.url), 'utf8').replaceAll(':global(:root)', ':root')
  const html = (row, template) => `<style>*{box-sizing:border-box}body{margin:0}.frame{container:v8-page/inline-size;width:calc(100vw - 248px)}.nameFolderRow>div{height:80px}input{width:100%;height:32px}${row}${template}</style><main><div class="frame" data-page-template="create"><div class="nameFolderRow" data-form-row="name-folder"><div><input aria-label="名前"></div><div><input aria-label="フォルダ"></div></div><aside style="width:280px;height:100px" data-template-region="preview" data-preview-narrow="hidden">見え方</aside></div></main>`
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const width of [1440, 1152]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(html(rowCss, tplCss))
      assert.deepEqual(await page.evaluate(scanFormRules), [])
      if (width === 1152) {
        await page.setContent(html(rowCss.replace('@container v8-page (width < 1100px)', '@container v8-page (width < 1px)'), ''))
        const faults = await page.evaluate(scanFormRules)
        assert.ok(faults.some(f => f.text === '狭い白い板では右欄を畳む'))
        assert.ok(faults.some(f => f.text === '狭い白い板では名前とフォルダを1列へ'))
      }
    }
  } finally { await browser.close() }
})
