import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { assess, record, measurePage, validateAllowances } from './layout-defects.mjs'
const shell = body => '<style>*{box-sizing:border-box}body{margin:0;font:16px/20px sans-serif}main{width:1000px}</style><main>'+body+'</main>'
const cases = {
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

test('空白検査はCIで一度だけ実行し、既存V8 guardと同じ必須扱い',()=>{
  const yaml = readFileSync('.github/workflows/required-pr-gate.yml','utf8')
  const job = yaml.split('  v8-screen-guard:')[1].split('  required-pr-gate:')[0]
  assert.equal((job.match(/run: node apps\/web\/scripts\/v8-guard\/layout-defects\.mjs /g)||[]).length,1)
  assert.doesNotMatch(job,/run:.*blank-gap\.mjs/,'blankfixの空白検査を別ステップで重ねない')
  const step=job.split('      - name: No new overlap')[1].split('      - name:')[0]
  assert.doesNotMatch(step,/continue-on-error/)
  assert.match(step,/steps.scope.outputs.run == 'true'/)
})
