// node apps/web/src/app/v8-parts/capture-cards.mjs [base URL]
// 本番exportをローカルで配信して使う。正本ファイルは変更しない。
import { chromium, expect } from '@playwright/test'
import { PNG } from 'pngjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:3123'
const refs = process.env.V8_PARTS_REF ?? '/Users/kentakenta/lh-work/design/v8/parts'
const out = path.resolve('design/v8/parts-check')
await fs.mkdir(out, { recursive: true })
const c = name => `[class*="_${name}__"]`
const radio = (id, top, icon, dot, title, note) => [id, [['本体', id, 'label'], ['印', icon, `${c('topIcon')} svg`], ['丸', dot, 'input'], ['題', title, c('title')], ['説明', note, c('note')]]]
const check = (id, dot, body, title, note) => [id, [['本体', id, 'label'], ['箱', dot, 'input'], ['文の列', body, c('body')], ['題', title, c('title')], ['説明', note, c('note')]]]
const cases = [
  radio('fNPdg', 'H20nP', 'QzCDJ', 'd4R6IM', 'mNkIc', 'c0iJ8'),
  radio('r3xz1W', 'DygQb', 'b7bAM', 'I2GcbZ', 'C55SBF', 'HAxCy'),
  check('w6uYMd', 'q2oJt0', 'j1e0TQ', 'H8ot4G', 'Ti0Gf'),
  check('RRxK5', 'PFJ0E', 'Q4KBy', 'IL2sk', 'G1dUJ3'),
  ['Q6cQB', [['本体','Q6cQB',c('toast')],['印','ubrRt',c('icon')],['文','Lg4uy',c('message')],['操作','g02lP',c('undo')]]],
  ['tnWX9', [['本体','tnWX9',c('toast')],['印','EOVld',c('icon')],['文','AQWgl',c('message')],['操作','uleC1',c('undo')]]],
  ['f6zwfs', [['本体','f6zwfs','[role="note"]'],['文','OYVVm','[role="note"]',true]]],
  ['ThDed', [['本体','ThDed',c('notice')],['印','vopYf',c('infoIconV8')],['文','L4Lb4P',c('message')]]],
  ['q3DPdz', [['本体','q3DPdz','[role="dialog"]'],['頭','I89Hu',c('headerRow')],['題と説明','VNQUe',c('headerContent')],['題','q2ooth',c('title')],['説明','O4ahMq',c('description')],['閉じる','Crlsc',c('close')],['閉じる印','ynkuu',`${c('close')} svg`],['手順帯','NUOgw',c('steps')],['済み丸','bRFUB',c('stepDone')],['現在丸','KAdEm',c('stepCurrent')],['接続線','P85G5',c('stepLine')],['中身','kliPY',c('content')],['役割の欄','TsAMR',c('field')],['役割ラベル','ASL77',`${c('field')} > span`,true],['役割の入力','WTAO4',`${c('field')} > select`],['下','taAJ0',c('actions')],['手順数','jqCi3',c('footerLead')],['戻る','n2caJ',`${c('actions')} > button:nth-of-type(1)`],['送る','ecLyt',`${c('actions')} > button:nth-of-type(2)`]]],
  ['hNXm7', [['本体','hNXm7','[data-list-state="empty"]'],['印の箱','zeOcV',c('iconWrap')],['印','sRYyy',`${c('iconWrap')} svg`],['題','iKaqt',c('title')],['説明','s1oJq2',c('description')],['作る','wygj0',`${c('action')} > button`]]],
  ['jr5Nl', [['本体','jr5Nl',c('row')],['顔','g2FeM',c('face')],['骨1','Ae4T8',`${c('row')} > :nth-child(2)`],['骨2','ube7D',`${c('row')} > :nth-child(3)`],['骨3','pCu4O',`${c('row')} > :nth-child(4)`],['骨4','pROzS',`${c('row')} > :nth-child(5)`]]],
  ['cfVyj', [['本体','cfVyj',c('phone')],['画面','zkvpQ',c('screen')],['上の帯','p7Ynu',c('statusBar')],['時刻','lTwzw',c('clock')],['島','SOUTw',c('island')],['電波と電池','nQvSg',c('statusIcons')],['トーク頭','gwnlQ',c('talkHead')],['名','ehRqF',c('talkName')],['トーク','zj6OU',c('talk')],['日付','IJIYr',c('dateChip')],['日付札','CaJ04',`${c('dateChip')} > span`],['日付文','L6XkF7',`${c('dateChip')} > span`,true],['受信行','DleVe',c('messageRow')],['顔','KgEuz',c('senderAvatar')],['送り主','ANUCc',c('senderName')],['吹き出し','xLemo',c('bubble')],['吹き出し本体','Z8qID',c('bubbleBody')],['本文','Tw20v',c('bubbleText')],['商品行','r9AXSM',c('cardRow')],['商品','jPMZd',c('productCard')],['写真','P08lo',c('productImage')],['商品文','o74OXs',c('productCopy')],['商品題','IrUHy',c('productTitle')],['商品説明','D9hGC',c('productDescription')],['値段行','sFzLa',c('priceRow')],['値段','PpjOn',c('price')],['税','I9260x',c('tax')],['メニュー帯','hRhzO',c('menuBar')],['ホーム帯','A3L7G',c('homeBar')],['ホーム線','i9fd4',c('homeLine')]]],
]
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
await context.addInitScript(() => {
  if (location.protocol === 'file:') return
  for (const [k,v] of Object.entries({lh_csrf:'visual-qa-csrf',lh_staff_role:'owner',lh_staff_name:'Kenta',lh_selected_account:'visual-qa-account',lh_auth_selection_cleared:'1','lh-admin-theme':'v8'})) localStorage.setItem(k,v)
  sessionStorage.setItem('lh_auth_selection_cleared','1')
  sessionStorage.setItem('lh_visual_qa_capture','1')
})
await context.route('http://worker.test/**', route => {
  const p = new URL(route.request().url()).pathname
  let data = []
  if (p === '/api/auth/session') data = {id:'visual-qa-owner',name:'Kenta',role:'owner',permissionKeys:[],viewPermissionKeys:[]}
  if (p === '/api/line-accounts') data = [{id:'visual-qa-account',name:'画面確認用',channelId:'preview',isActive:true,role:'owner',country:'JP',displayOrder:0}]
  if (p === '/api/line-accounts/visual-qa-account') data = {id:'visual-qa-account',name:'画面確認用',isActive:true}
  if (p === '/admin/version') data = {version:'0.24.0'}
  return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':new URL(base).origin,'access-control-allow-credentials':'true','access-control-allow-headers':'*','access-control-allow-methods':'GET,OPTIONS'},body:JSON.stringify({success:true,data})})
})
const actual = await context.newPage()
actual.on('pageerror', error => console.error('pageerror', error.message))
await actual.goto(`${base}/v8-parts.html`)
console.log('確認ページ起動')
await actual.locator('[data-parts-lane="cards"]').waitFor({timeout:30000})
await actual.evaluate(() => document.fonts.ready)
await actual.getByRole('button',{name:'日時の説明'}).click()
await actual.mouse.move(1400,1000)
await actual.waitForTimeout(300)

// 明示された装飾と寸法を比較。描かれていない0px枠の色、コンテナが継承した
// 未指定の書体は比較対象に含めない。outline は枠として必ず比較する。
function measure(el) {
  const cs = getComputedStyle(el), r = el.getBoundingClientRect()
  const props = ['paddingTop','paddingRight','paddingBottom','paddingLeft','rowGap','columnGap','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius','backgroundColor','boxShadow','outlineWidth','outlineColor','outlineOffset','fontSize','fontWeight','color','lineHeight']
  const values = Object.fromEntries(props.map(k => [k, cs[k] === 'normal' && /Gap/.test(k) ? '0px' : cs[k]]))
  if (cs.outlineStyle === 'none') values.outlineWidth = '0px'
  const painted = el.tagName.toLowerCase()==='svg' ? getComputedStyle(el.querySelector('path') ?? el) : null
  return {width:r.width,height:r.height,...values,authoredFont:!!el.style.fontSize, svgColor:painted ? (painted.fill === 'none' ? painted.stroke : painted.fill) : null}
}
const all = []
const numeric = /^(width|height|padding|rowGap|columnGap|border.*Width|border.*Radius|outlineWidth|outlineOffset|fontSize|lineHeight)/
for (const [id,pairs] of cases) {
  const ref = await context.newPage()
  console.log('比較開始', id)
  await ref.goto(`file://${refs}/${id}.html`)
  await ref.evaluate(() => document.fonts.ready)
  const refRoot = ref.locator(`[data-pencil-id="${id}"]`).first()
  const sample = actual.locator(`[data-sample="${id}"]`)
  const rows = []
  for (const [name,node,selector,textOnly] of pairs) {
    const expected = await ref.locator(`[data-pencil-id="${node}"]`).first().evaluate(measure)
    const got = await sample.locator(selector).first().evaluate(measure)
    const keys = textOnly ? ['fontSize','fontWeight','color','lineHeight'] : Object.keys(expected).filter(k => !['authoredFont','svgColor'].includes(k))
    for (const key of keys) {
      if (['fontSize','fontWeight','color','lineHeight'].includes(key) && !expected.authoredFont) continue
      if (/border.*Color/.test(key) && parseFloat(expected[key.replace('Color','Width')])===0 && parseFloat(got[key.replace('Color','Width')])===0) continue
      if (['outlineColor','outlineOffset'].includes(key) && parseFloat(expected.outlineWidth)===0 && parseFloat(got.outlineWidth)===0) continue
      const a=expected[key],b=got[key]
      const delta=numeric.test(key)?Math.abs(parseFloat(a)-parseFloat(b)):null
      const pass=delta!==null?Number.isFinite(delta)&&delta<=1:a===b
      rows.push({name,node,selector,key,expected:a,actual:b,delta,pass})
    }
    if (expected.svgColor) rows.push({name,node,selector,key:'印の色',expected:expected.svgColor,actual:got.svgColor,delta:null,pass:expected.svgColor.toLowerCase()===got.svgColor?.toLowerCase()})
  }
  // スクリーンショットは1440幅で開いたページの部品領域を切り出して左右に並べる。
  const rootSelector = pairs[0][2]
  const a=PNG.sync.read(await refRoot.screenshot({animations:'disabled'}))
  const b=PNG.sync.read(await sample.locator(rootSelector).first().screenshot({animations:'disabled'}))
  const composite=new PNG({width:Math.max(a.width,b.width)*2+64,height:Math.max(a.height,b.height)+64})
  composite.data.fill(255)
  PNG.bitblt(a,composite,0,0,a.width,a.height,16,32)
  PNG.bitblt(b,composite,0,0,b.width,b.height,Math.max(a.width,b.width)+48,32)
  await fs.writeFile(path.join(out,`${id}.png`),PNG.sync.write(composite))
  const failures=rows.filter(r=>!r.pass)
  const max=Math.max(0,...rows.map(r=>r.delta??0).filter(Number.isFinite))
  all.push({id,elements:pairs.length,max,failures:failures.length,rows})
  console.log(id,`差 ${max.toFixed(3)}px`,failures.length?`不一致 ${failures.length}`:'数値合格')
  for(const row of failures) console.log(`  ${row.name} ${row.key}: ${row.expected} -> ${row.actual}`)
  await ref.close()
}
await fs.writeFile(path.join(out,'cards-values.json'),JSON.stringify({base,viewport:1440,baseSha:execFileSync('git',['rev-parse','origin/codex/development'],{encoding:'utf8'}).trim(),cases:all},null,2))
let report='# cards レーン：共通部品の実測\n\n1440×1080・Chromium・本番ビルド・動きを減らす設定。左＝正本HTML、右＝実装。\n\n正本は `'+refs+'/<ID>.html`。実装は `/v8-parts/`。正本ファイルは変更していません。\n\n数値は差が1px以下、色・影は完全一致で合格。枠がoutlineで描かれているため、borderとoutlineの両方を測っています。文字だけを比較する行は寸法欄を省きます。\n\n|部品ID|測定要素|最大寸法差|不一致項目|数値判定|画像の判定|\n|---|---:|---:|---:|---|---|\n'
for(const r of all) report+=`|${r.id}|${r.elements}|${r.max.toFixed(3)}px|${r.failures}|${r.failures?'要修正':'合格'}|司令塔の確認待ち|\n`
for(const r of all){
 report+=`\n## ${r.id}\n\n画像： [${r.id}.png](./${r.id}.png)\n\n|要素（正本のID）|項目|正本|実装|差|判定|\n|---|---|---|---|---|---|\n`
 for(const v of r.rows) report+=`|${v.name} (${v.node})|${v.key}|${v.expected}|${v.actual}|${v.delta===null?'完全一致で比較':v.delta.toFixed(3)+'px'}|${v.pass?'合格':'要修正'}|\n`
}
await fs.writeFile(path.join(out,'cards.md'),report)
// 実測後、同じ本番ページで操作が残っていることも確認する。
const offRadio = actual.locator('[data-sample="r3xz1W"] input')
await offRadio.check()
await expect(offRadio).toBeChecked()
const checkedBox = actual.locator('[data-sample="w6uYMd"] input')
await checkedBox.uncheck()
await expect(checkedBox).not.toBeChecked()
await actual.locator('[data-sample="Q6cQB"]').getByRole('button', { name: '元に戻す' }).click()
await expect(actual.locator('output')).toHaveText('元に戻しました')
await actual.locator('[data-sample="tnWX9"]').getByRole('button', { name: 'もう一度' }).click()
await expect(actual.locator('output')).toHaveText('再試行しました')
await actual.getByRole('button', { name: '日時の説明' }).click()
await actual.getByRole('button', { name: '日時の説明' }).click()
await actual.keyboard.press('Escape')
await expect(actual.locator('[data-sample="f6zwfs"] [role="note"]')).toHaveCount(0)
await actual.locator('[data-sample="q3DPdz"]').getByRole('button', { name: '閉じる', exact: true }).click()
await expect(actual.locator('[data-sample="q3DPdz"] [role="dialog"]')).toHaveCount(0)
await actual.getByRole('button', { name: 'ダイアログを開く' }).click()
await actual.locator('[data-sample="q3DPdz"]').getByRole('button', { name: '招待を送る' }).click()
await expect(actual.locator('output')).toHaveText('招待しました')
await actual.getByRole('button', { name: '定期便に追加' }).click()
await expect(actual.locator('output')).toHaveText('定期便に追加します')
report += '\n## 操作の確認\n\n本番ページでラジオの切り替え、チェックの解除、元に戻す、再試行、ふきだしのEscape、窓の閉じる・開く・実行、LINEの商品操作を確認しました。実データは送信していません。\n'
await fs.writeFile(path.join(out,'cards.md'),report)
console.log('操作の確認：合格')
await browser.close()
if(all.some(r=>r.failures)) process.exitCode=1
