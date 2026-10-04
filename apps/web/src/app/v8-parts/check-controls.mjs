/** 本番書き出しと正本HTMLを1440pxで比較。node .../check-controls.mjs [outdir] [webport] [refport] */
import { chromium } from '@playwright/test'
import { PNG } from 'pngjs'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const out = path.resolve(process.argv[2] ?? 'design/v8/parts-check')
const web = `http://127.0.0.1:${process.argv[3] ?? 3219}`
const ref = `http://127.0.0.1:${process.argv[4] ?? 3218}`
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
await context.addInitScript(() => {
  for (const [k, v] of Object.entries({ 'lh-admin-theme': 'v8', lh_selected_account: 'parts-account', lh_staff_role: 'owner', lh_csrf: 'parts-csrf', lh_auth_selection_cleared: '1' })) localStorage.setItem(k, v)
})
await context.route('http://worker.test/**', async (route) => {
  const pathname = new URL(route.request().url()).pathname
  const data = pathname === '/api/auth/session' ? { name: '部品確認', role: 'owner', tenantStatus: 'active', permissionKeys: [] }
    : pathname === '/api/line-accounts' ? [{ id: 'parts-account', name: '部品確認', status: 'active' }]
    : pathname.endsWith('/features') ? [] : pathname.includes('version') ? { latestVersion: '0.24.0', currentVersion: '0.24.0', mode: 'latest' } : []
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': web, 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify({ success: true, data }) })
})
await context.route(`${web}/_next/static/media/**`, async (route) => {
  const response = await route.fetch()
  await route.fulfill({ response, headers: { ...response.headers(), 'Access-Control-Allow-Origin': '*' } })
})
const page = await context.newPage()
await page.goto(`${web}/v8-parts.html`)
await page.locator('[data-part-id="doYdE"]').waitFor()
await page.evaluate(() => document.fonts.ready)
await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' })
// next/fontで同梱した同じフォントを参照側でも使う。寸法や部品のCSSは変えない。
const faces = await page.evaluate(() => [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].filter((r) => r.type === CSSRule.FONT_FACE_RULE).map((r) => r.cssText) } catch { return [] } }).join('\n'))
const refFaces = faces.replace(/font-family:\s*([^;]+);/g, (m, name) => /Noto/.test(name) && !/Fallback/.test(name) ? 'font-family: "Noto Sans JP";' : /Inter/.test(name) && !/Fallback/.test(name) ? 'font-family: Inter;' : m).replace(/url\("?(\/[^)"\s]+)"?\)/g, (_, u) => `url("${web}${u}")`)
const dim = ['width', 'height']
const box = [...dim, 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle', 'outlineWidth', 'outlineStyle', 'outlineColor', 'outlineOffset', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'backgroundColor', 'boxShadow']
const type = ['fontSize', 'fontWeight', 'color', 'lineHeight', 'letterSpacing', 'webkitFontSmoothing']
const metrics = [...new Set([...box, ...type, 'fontFamily', 'fontVariantNumeric'])]
const get = async (locator, pseudo) => locator.evaluate((el, { metrics, pseudo }) => {
  const css = getComputedStyle(el, pseudo)
  const rect = el.getBoundingClientRect()
  const result = Object.fromEntries(metrics.map((k) => [k, css[k]]))
  // Chromiumのinput::placeholderはline-heightをnormalで返す。行箱はinputの値を使う。
  if (pseudo === '::placeholder' && result.lineHeight === 'normal') result.lineHeight = getComputedStyle(el).lineHeight
  if (!pseudo) { result.width = `${rect.width}px`; result.height = `${rect.height}px` }
  return result
}, { metrics, pseudo })
const byId = (p, id) => p.locator(`[data-pencil-id="${id}"], [data-layer-id="${id}"]`).first()
const cls = (base, name) => `[class*="${base}_${name}__"]`
const specs = []
const pair = (id, root, pairs = []) => specs.push({ id, root, pairs })
for (const [id, label, icon] of [['doYdE','EgasS','J02D70'],['u101P','aw1Ey'],['LrB2L','AzuMn'],['wDPmk','cuKOs','Yx6FI']]) pair(id, 'button', [[label,'button',type], ...(icon ? [[icon,'svg',dim]] : [])])
pair('KspUx','button',[['ynkuu','svg',dim]])
pair('g5Db8','a',[['Qa7Ci',cls('text-link','label'),[...dim,...type]],['Us7mb','svg',dim]])
pair('Ume2U',cls('form-controls','field'),[['ASL77','label',[...dim,...type]],['WTAO4','input',box],['Fa6ke','input::placeholder',type]])
pair('wMMk6','button',[['DyeJZ',cls('select','value'),[...dim,...type]],['m1uZy','svg',dim]])
pair('TkVyB',cls('search-field','search'),[['yXWth','svg',dim],['YUvHF','input::placeholder',type]])
pair('dQCCN',cls('checkbox','root'),[['ATnLY',cls('checkbox','box'),box],['lwgrF',cls('checkbox','check'),dim],['I4KJR0',cls('checkbox','label'),[...dim,...type]]])
pair('S9U7v',cls('checkbox','root'),[['JQqCm',cls('checkbox','box'),box],['r8KoFy',cls('checkbox','label'),[...dim,...type]]])
pair('y4YQSB','label',[['P74Jdk','input',box],['F8nSF','span',[...dim,...type]]])
pair('gzxYf','label',[['ZYJLP','input',box],['fWS6W','span',[...dim,...type]]])
pair('bkjTv','button',[['v9S4U','button::after',box]])
pair('LxHpj','button',[['E6ZiV','button::after',box]])
pair('dtJVi',cls('segmented','root'),[['OScFF',cls('segmented','item')+':nth-of-type(1)',[...dim,'paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopLeftRadius']],['OScFF',cls('segmented','thumb'),['backgroundColor','boxShadow','borderTopLeftRadius']],['sxkwr',cls('segmented','item')+':nth-of-type(1)',type],['exOU7',cls('segmented','item')+':nth-of-type(2)',type],['O4lnNC',cls('segmented','item')+':nth-of-type(3)',type]])
pair('clV5c','nav',[['Hs1F8','[role="tab"]:nth-of-type(1)',[...dim,'paddingBottom']],['RvDko','[role="tab"]:nth-of-type(1)',type],['gPTpL','[role="tab"]:nth-of-type(2)',type],['CPn24','[role="tab"]:nth-of-type(3)',type],['edJqK','[role="tab"]:nth-of-type(4)',type],['clV5c','[role="tablist"]',['columnGap']]])
pair('O2fCAt','button',[['QurVs','svg',dim],['hSViE','button',type]])
pair('XGJDa','button',[['KBxXq','svg',dim],['N5xdkT','button',type]])
pair('RfHCo',cls('otp-input','field'),[['Oxnys',cls('otp-input','label'),[...dim,...type]],['HNQzl',cls('otp-input','group'),[...dim,'columnGap']], ...['AOPqG','dVqPW','Ilz8f','z5NHuv','l07AI','fyTpB'].map((id,i)=>[id,`input:nth-of-type(${i+1})`,box]),['DXfeM','input:nth-of-type(1)',[...type,'fontVariantNumeric']],['fEnOR','input:nth-of-type(2)',[...type,'fontVariantNumeric']]])
pair('cMbie',cls('otp-input','field'),[['ynj67',cls('otp-input','label'),[...dim,...type]],['ArREe',cls('otp-input','group'),[...dim,'columnGap']],...['BHUdK','neyyS','P2vwH6','JZzrN','U7vdS','R3kN2'].map((id,i)=>[id,`input:nth-of-type(${i+1})`,box]),['XvAHv','input:nth-of-type(1)',[...type,'fontVariantNumeric']]])
pair('prbOC',cls('delete-button','tile'),[['scMGW','svg',dim]])
pair('zopvP',cls('delete-button','root'),[['J032Vb',cls('delete-button','tile'),[...dim,'backgroundColor']],['KiNxw',cls('delete-button','tile')+' svg',dim],['MlVXM',cls('delete-button','confirm'),box],['K7sqaI',cls('delete-button','yes'),box],['PA7uk',cls('delete-button','no'),box],['foeW5',cls('delete-button','yes')+' svg',dim],['R8LAy',cls('delete-button','no')+' svg',dim]])
pair('KVkPg',cls('color-well','well'),[['J2fUpO',cls('color-well','swatch'),box],['o7LKlF',cls('color-well','divider'),box],['P5lM4','svg',dim]])
pair('mpJVS',cls('color-well','pop'),[['gRgY8',cls('color-well','grid'),[...dim,'rowGap','columnGap']],['ZQgH7',cls('color-well','cell')+':nth-of-type(1)',box],['z9368F',cls('color-well','cell')+':nth-of-type(11)',box],['o2ErFM',cls('color-well','hexField'),box],['cCWPj',cls('color-well','hexInput'),type],['aP4YB',cls('color-well','dropper')+' svg',dim]])
const results=[]
for (const spec of specs) {
  const sample=page.locator(`[data-part-id="${spec.id}"]`)
  await sample.scrollIntoViewIfNeeded()
  if(spec.id==='zopvP') await sample.locator('button').first().click()
  if(spec.id==='mpJVS') await sample.locator('button').first().click()
  if(spec.id==='RfHCo') await sample.locator('input').nth(2).focus()
  const rp = await context.newPage()
  await rp.route('https://fonts.googleapis.com/**', r=>r.abort())
  await rp.goto(`${ref}/${spec.id}.html`)
  await rp.addStyleTag({content: refFaces})
  await rp.evaluate(() => document.fonts.ready)
  await rp.evaluate(()=>{document.body.style.background='#ffffff';document.body.style.padding='24px'})
  const pairs=[[spec.id,spec.root,box],...spec.pairs]
  // 色見本は24個すべてを測り、順番・位置・選択の輪郭も確かめる。
  if (spec.id === 'mpJVS') {
    const cells = await rp.locator('[data-pencil-name^="見本 #"]').evaluateAll(els => els.map(el => el.dataset.pencilId))
    for (const [i, id] of cells.entries()) pairs.push([id, `${cls('color-well','cell')}:nth-of-type(${i+1})`, box])
  }
  const refRoot = await byId(rp, spec.id).boundingBox()
  const implRoot = await sample.locator(spec.root).first().boundingBox()
  const position = async (locator, root, textOnly) => locator.evaluate((el, { root, textOnly }) => {
    let rect = el.getBoundingClientRect()
    if (textOnly && el.tagName !== 'INPUT') {
      const node = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
      if (node) { const range = document.createRange(); range.selectNodeContents(node); rect = range.getBoundingClientRect() }
    }
    return { x: rect.x - root.x, y: rect.y - root.y }
  }, { root, textOnly })
  const rows=[]
  for (const [rid, selector, props] of pairs) {
    const [sel,pseudo]=selector.split('::')
    const reference=await get(byId(rp,rid))
    const implementation=await get(sample.locator(sel).first(),pseudo?`::${pseudo}`:undefined)
    const differences=[]
    for(const prop of props) {
      // 無い枠の色は描かれない。同様にoutline:noneでは色・offsetを比較しない。
      if(/border.*(Color|Style)/.test(prop) && parseFloat(reference[prop.replace(/Color|Style/,'Width')])===0 && parseFloat(implementation[prop.replace(/Color|Style/,'Width')])===0) continue
      if(['outlineColor','outlineOffset'].includes(prop) && reference.outlineStyle==='none' && implementation.outlineStyle==='none') continue
      const a=reference[prop],b=implementation[prop]
      const numeric=/^-?[\d.]+px$/.test(a)&&/^-?[\d.]+px$/.test(b)
      const delta=numeric?Math.abs(parseFloat(a)-parseFloat(b)):a===b?0:null
      if(delta===null||delta>0) differences.push({property:prop,reference:a,implementation:b,delta,pass:delta!==null&&delta<=1})
    }
    // 要素の位置を部品の左上から測る。文字だけの比較では親ボタンの文字の範囲を使う。
    let geometry = null
    if (!pseudo && rid !== spec.id && !selector.includes('thumb') && !selector.includes('tablist') && !(selector.startsWith('input') && props.includes('fontSize') && !props.includes('width'))) {
      const textOnly = props === type
      const a = await position(byId(rp,rid), refRoot, false)
      const geometrySelector = rid === 'cCWPj' ? cls('color-well','hexMark') : sel
      const b = await position(sample.locator(geometrySelector).first(), implRoot, textOnly)
      geometry = { reference: a, implementation: b }
      for (const axis of ['x','y']) {
        const delta = Math.abs(a[axis]-b[axis])
        if (delta > 0) differences.push({ property: `relative${axis.toUpperCase()}`, reference: `${a[axis]}px`, implementation: `${b[axis]}px`, delta, pass: delta<=1 })
      }
    }
    rows.push({referenceId:rid,selector,properties:props,reference,implementation,geometry,differences})
  }
  const failed=rows.flatMap(r=>r.differences.filter(d=>!d.pass))
  const numeric=rows.flatMap(r=>r.differences.map(d=>d.delta).filter(d=>typeof d==='number'))
  const root=sample.locator(spec.root).first()
  await root.scrollIntoViewIfNeeded()
  const rbox=await byId(rp,spec.id).boundingBox(),ibox=await root.boundingBox()
  const snap=async(p,b)=>PNG.sync.read(await p.screenshot({clip:{x:Math.max(0,b.x-12),y:Math.max(0,b.y-12),width:b.width+24,height:b.height+24}}))
  await root.evaluate(el=>el.setAttribute('data-capture-root',''))
  const isolation = await page.addStyleTag({ content: 'body{background:#fff!important}body *{visibility:hidden!important}[data-capture-root],[data-capture-root] *{visibility:visible!important}' })
  const left=await snap(rp,rbox),right=await snap(page,ibox)
  await isolation.evaluate(el=>el.remove())
  await root.evaluate(el=>el.removeAttribute('data-capture-root'))
  const combined=new PNG({width:left.width+right.width+24,height:Math.max(left.height,right.height),fill:true})
  combined.data.fill(255)
  PNG.bitblt(left,combined,0,0,left.width,left.height,0,0)
  PNG.bitblt(right,combined,0,0,right.width,right.height,left.width+24,0)
  fs.writeFileSync(path.join(out,`${spec.id}.png`),PNG.sync.write(combined))
  // 白地上の輪郭を重ね、4pxを超えて離れた描画を両方向に数える。
  // アンチエイリアスを合否に混ぜないため、白から32以上離れた画素を輪郭とする。
  const width = Math.max(left.width,right.width), height = Math.max(left.height,right.height)
  const foreground = (png,x,y) => x>=0&&y>=0&&x<png.width&&y<png.height && Math.min(...png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+3))<223
  let overlayOver4px=0
  for (const [a,b] of [[left,right],[right,left]]) for(let y=0;y<a.height;y++) for(let x=0;x<a.width;x++) {
    if(!foreground(a,x,y))continue
    let match=false
    for(let dy=-4;dy<=4&&!match;dy++)for(let dx=-4;dx<=4&&!match;dx++)if(dx*dx+dy*dy<=16&&foreground(b,x+dx,y+dy))match=true
    if(!match)overlayOver4px++
  }
  const overlay = new PNG({ width, height })
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++) {
    const read=(png)=>x<png.width&&y<png.height?png.data[(y*png.width+x)*4+c]:255
    overlay.data[(y*width+x)*4+c]=Math.round((read(left)+read(right))/2)
  }
  fs.writeFileSync(path.join(out,`${spec.id}-overlay.png`),PNG.sync.write(overlay))
  results.push({id:spec.id,pass:failed.length===0&&overlayOver4px===0,overlayOver4px,maxPx:Math.max(0,...numeric),over4px:rows.flatMap(r=>r.differences).filter(d=>d.delta>4).length,failed,rows})
  console.log(spec.id,failed.length?`不合格 ${failed.length}`:'数値合格',failed.map(d=>`${d.property}:${d.reference}→${d.implementation}`).join('; '))
  await rp.close()
  if(spec.id==='mpJVS') await page.keyboard.press('Escape')
}
// 実物の部品で操作が残っていることを確認する（確認ページの状態だけを変更）。
const interactions=[]
const check=(name,ok)=>{interactions.push({name,pass:ok});if(!ok)throw new Error(`操作の不合格: ${name}`)}
const sample=id=>page.locator(`[data-part-id="${id}"]`)
await sample('S9U7v').locator('label').click()
check('チェックを切り替える',await sample('S9U7v').locator('input').isChecked())
await sample('gzxYf').locator('label').click()
check('ラジオは同じ組の1つだけを選ぶ',await sample('gzxYf').locator('input').isChecked()&&!await sample('y4YQSB').locator('input').isChecked())
await sample('bkjTv').getByRole('switch').click()
check('トグルを切り替える',await sample('bkjTv').getByRole('switch').getAttribute('aria-checked')==='false')
await sample('dtJVi').locator('button').first().focus()
await page.keyboard.press('ArrowRight')
check('切り替えは矢印キーでも動く',await sample('dtJVi').locator('button').nth(1).getAttribute('aria-pressed')==='true')
await sample('clV5c').getByRole('tab').nth(1).click()
check('タブを切り替える',await sample('clV5c').getByRole('tab').nth(1).getAttribute('aria-selected')==='true')
await sample('O2fCAt').locator('button').click()
check('絞り込みの札を切り替える',await sample('O2fCAt').locator('button').getAttribute('aria-pressed')==='true')
await sample('RfHCo').locator('input').first().fill('482917')
check('認証コードの自動入力を6マスへ配る',(await sample('RfHCo').locator('input').evaluateAll(els=>els.map(e=>e.value).join('')))==='482917')
await sample('prbOC').locator('button').first().click()
await page.keyboard.press('Escape')
check('削除の確認はEscapeで取り消せる',!await sample('prbOC').getByRole('button',{name:'やめる'}).isVisible())
await sample('prbOC').locator('button').first().click()
await sample('prbOC').getByRole('button',{name:'削除',exact:true}).click()
check('確認してから削除処理を呼ぶ',(await page.getByRole('status').last().innerText()).includes('確認ボタンを押しました'))
await sample('mpJVS').locator('button').first().click()
await sample('mpJVS').getByRole('option',{name:'#3b82f6',exact:true}).click()
check('色の見本を選ぶと色が変わり閉じる',!await sample('mpJVS').getByRole('dialog').count()&&(await sample('mpJVS').locator('button').first().getAttribute('aria-label')).includes('#3b82f6'))
await sample('mpJVS').locator('button').first().click()
await sample('mpJVS').getByRole('textbox').fill('12abcd')
await sample('mpJVS').getByRole('textbox').press('Enter')
check('十六進の色を入力できる',(await sample('mpJVS').locator('button').first().getAttribute('aria-label')).includes('#12abcd'))
fs.writeFileSync(path.join(out,'controls-interactions.json'),JSON.stringify(interactions,null,2))
// v7は現在の部品CSSと、基準コミットの部品CSSを同じDOM上で比較する。
// 新設Radio・text variantは比較対象外。OTPの追加の器はdisplay:contentsのまま。
await page.evaluate(() => {
  document.activeElement?.blur()
  document.documentElement.dataset.theme='v7'
  localStorage.setItem('lh-admin-theme','v7')
  window.dispatchEvent(new Event('lh:admin-theme-changed'))
})
await page.locator('[data-part-id="mpJVS"] button').first().click()
const v7Specs=specs.filter(s=>!['wDPmk','y4YQSB','gzxYf'].includes(s.id))
const v7Root=s=>['RfHCo','cMbie'].includes(s.id)?cls('otp-input','group'):s.root
const captureV7=async spec=>{
  const el=page.locator(`[data-part-id="${spec.id}"]`).locator(v7Root(spec)).first()
  await el.scrollIntoViewIfNeeded()
  await el.evaluate(e=>e.setAttribute('data-capture-root',''))
  const isolation=await page.addStyleTag({content:'body{background:#fff!important}body *{visibility:hidden!important}[data-capture-root],[data-capture-root] *{visibility:visible!important}'})
  const png=PNG.sync.read(await el.screenshot())
  await isolation.evaluate(e=>e.remove())
  await el.evaluate(e=>e.removeAttribute('data-capture-root'))
  return png
}
const v7After=[]
for(const spec of v7Specs)v7After.push(await captureV7(spec))
const modules=['button','icon-button','text-link','text-field','form-controls','select','search-field','checkbox','toggle','segmented','tabs','otp-input','delete-button','color-well']
const originalStyles=modules.map(name=>({prefix:name,source:execFileSync('git',['show',`${fs.readFileSync(path.join(out,'controls-base-sha.txt'),'utf8').trim()}:apps/web/src/components/shared/${name}.module.css`],{encoding:'utf8'})}))
originalStyles.push({prefix:'v6-filter-chip',source:execFileSync('git',['show',`${fs.readFileSync(path.join(out,'controls-base-sha.txt'),'utf8').trim()}:apps/web/src/components/shared/filter-chip.css`],{encoding:'utf8'})})
const originalCSS=await page.evaluate(styles=>{
  const css=[...document.styleSheets].map(s=>{try{return [...s.cssRules].map(r=>r.cssText).join('\n')}catch{return ''}}).join('\n')
  const mapped=new Map([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*?)_([a-zA-Z][a-zA-Z0-9_-]*?)__([a-zA-Z0-9_-]+)/g)].map(m=>[`${m[1]}.${m[2]}`,m[0]]))
  const matches=selector=>styles.some(s=>selector.includes(`.${s.prefix}_`)||s.prefix==='v6-filter-chip'&&selector.includes('.v6-filter-chip'))
  const strip=parent=>{
    for(let i=parent.cssRules.length-1;i>=0;i--){
      const r=parent.cssRules[i]
      if(r.selectorText&&matches(r.selectorText))parent.deleteRule(i)
      else if(r.cssRules)strip(r)
    }
  }
  for(const sheet of [...document.styleSheets]){try{strip(sheet)}catch{}}
  return styles.map(({prefix,source})=>source.replace(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g,(m,name)=>mapped.get(`${prefix}.${name}`)||m)).join('\n')
},originalStyles)
await page.addStyleTag({content:originalCSS+'\n@layer components{[class*="otp-input_field__"]{display:contents}}'})
const v7=[]
for(const [i,spec] of v7Specs.entries()){
  const before=await captureV7(spec),after=v7After[i]
  let changed=0
  if(before.width!==after.width||before.height!==after.height)changed=-1
  else for(let p=0;p<before.data.length;p+=4)if(before.data[p]!==after.data[p]||before.data[p+1]!==after.data[p+1]||before.data[p+2]!==after.data[p+2])changed++
  const pair=new PNG({width:before.width+after.width+24,height:Math.max(before.height,after.height)})
  pair.data.fill(255);PNG.bitblt(before,pair,0,0,before.width,before.height,0,0);PNG.bitblt(after,pair,0,0,after.width,after.height,before.width+24,0)
  fs.writeFileSync(path.join(out,`${spec.id}-v7.png`),PNG.sync.write(pair))
  v7.push({id:spec.id,changedPixels:changed,pass:changed===0})
  console.log('v7',spec.id,changed)
}
fs.writeFileSync(path.join(out,'controls-v7.json'),JSON.stringify(v7,null,2))
fs.writeFileSync(path.join(out,'controls.json'),JSON.stringify({viewport:1440,baseSha:fs.readFileSync(path.join(out,'controls-base-sha.txt'),'utf8').trim(),results},null,2))
const names=['主ボタン','副ボタン','危険ボタン','文字ボタン','アイコンボタン','リンク','入力欄','選ぶ欄','検索','チェック・オン','チェック・オフ','ラジオ・オン','ラジオ・オフ','トグル・オン','トグル・オフ','切り替え','タブ','絞り込み・オフ','絞り込み・オン','OTP入力','OTP完了','削除ボタン','削除確認','色選び','色選び・開いた状態']
const md=['# controls レーンの比較','',`比較幅：1440px。正本：/Users/kentakenta/lh-work/design/v8/parts/<ID>.html。実装：本番書き出し /v8-parts/。`,'','正本のDOM印は data-pencil-id（一部は data-layer-id）。両側に同じ同梱フォントを読み込み、参照ページの外側の地だけ白に統一。部品のCSSは変更せず計測。1px以内は数値合格、色・影・文字の太さは完全一致。Pencilの枠はoutlineのためborderとoutlineの両方を取得。描かれない0px枠の色・線種は比較対象外。Chromiumがnormalを返すplaceholderの行高はinput本体の行高を記録。位置は部品の左上から測る。文字は文字要素同士、入力欄の文字はplaceholder/入力値で比較。全取得値は controls.json。画像は左が絵、右が実装。周りのページを隠して部品だけを撮影。*-overlay.pngは左上を合わせた50%重ね合わせ。重ねた輪郭4px超は白から32以上離れた画素の両方向の最寄り距離（色の検査はcomputed styleで別に完全一致を要求）。最終画像合否は司令塔が確認。','', '| ID | 部品 | 数値判定 | 最大px差 | 色などの不一致 | 位置・寸法4px超 | 重ねた輪郭4px超（画素） | 画像 |','|---|---|---|---:|---:|---:|---:|---|',...results.map((r,i)=>`| ${r.id} | ${names[i]} | ${r.pass?'合格':'不合格'} | ${r.maxPx.toFixed(3)} | ${r.failed.filter(d=>d.delta===null).length} | ${r.over4px} | ${r.overlayOver4px} | [並べた画像](${r.id}.png) |`),'','## 要素別の差','',...results.flatMap(r=>[`### ${r.id}`,'','| 正本の要素 | 実装 | 属性 | 絵 | 実装 | 差 | 判定 |','|---|---|---|---|---|---:|---|',...r.rows.flatMap(row=>row.differences.map(d=>`| ${row.referenceId} | ${row.selector} | ${d.property} | ${d.reference} | ${d.implementation} | ${d.delta===null?'文字指定不一致':d.delta.toFixed(3)} | ${d.pass?'1px以内':'要修正'} |`)),...(r.rows.every(row=>!row.differences.length)?['| 全計測要素 | — | 比較対象すべて | 同値 | 同値 | 0 | 合格 |']:[]),''])]
md.push('## 操作の確認', '', ...interactions.map(r=>`- ${r.name}：${r.pass?'合格':'不合格'}`), '', '## v7の比較', '', '基準コミットの部品CSSを同じ確認ページのDOMへ読み込み直して比較。左が基準CSS、右が修正CSS。新設の文字ボタンと行内ラジオは旧部品が無いため対象外。', '', '| ID | 差分画素 | 判定 |', '|---|---:|---|', ...v7.map(r=>`| ${r.id} | ${r.changedPixels} | ${r.pass?'合格':'要修正'} |`))
fs.writeFileSync(path.join(out,'controls.md'),md.join('\n'))
await browser.close()
if(results.some(r=>!r.pass)||v7.some(r=>!r.pass)||interactions.some(r=>!r.pass))process.exitCode=1
