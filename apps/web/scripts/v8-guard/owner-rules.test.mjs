import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './owner-rules-browser.mjs'
import scanPolish from './polish-rules-browser.mjs'
import scanRowHeights from './control-row-height-browser.mjs'

test('a framed box clipped by its parent fails; scrollable and restored boxes remain usable', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const body = '<main><div id="parent" style="height:80px;overflow:hidden"><section style="width:160px;height:160px;border:1px solid">本文</section></div></main>'
    await page.setContent(body)
    assert.ok((await page.evaluate(scan)).some(f=>f.kind==='boxclip'))
    await page.locator('#parent').evaluate(el=>{el.style.overflowY='auto'})
    assert.deepEqual(await page.evaluate(scan),[])
    await page.locator('#parent').evaluate(el=>{el.style.height='auto';el.style.overflowY='hidden'})
    assert.deepEqual(await page.evaluate(scan),[])
  } finally { await browser.close() }
})

test('高さをそろえる段で、同じ行のカードの高さか下端の操作がずれると落ち、そろえば通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const card = (id, info) => `<article id="${id}" data-design-part="card" style="display:flex;flex-direction:column"><div style="flex:1 0 auto;min-height:${info}px">情報</div><div data-card-actions style="height:32px">操作</div></article>`
    await page.setContent(`<main><div data-card-height="equal" style="display:grid;grid-template-columns:repeat(3,200px);align-items:start;gap:16px">${card('warned', 120)}${card('plain', 60)}${card('archived', 40)}</div></main>`)
    const broken = (await page.evaluate(scan)).filter(f => f.kind === 'cardrow')
    assert.equal(broken.length, 1)
    assert.deepEqual(broken[0].measure, { height: 80, actions: 80 })
    await page.locator('[data-card-height]').evaluate(el => { el.style.alignItems = 'stretch' })
    assert.deepEqual((await page.evaluate(scan)).filter(f => f.kind === 'cardrow'), [])
    await page.locator('#plain > [data-card-actions]').evaluate(el => { el.style.marginBottom = '20px' })
    assert.deepEqual((await page.evaluate(scan)).filter(f => f.kind === 'cardrow').map(f => f.measure), [{ height: 0, actions: 20 }])
  } finally { await browser.close() }
})

test('small UI text drawn at weight 400 fails; 500 and larger reading text pass', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<html data-theme="v8"><body><main><p id="small" style="font-size:12px;font-weight:500">補足の文字</p><p style="font-size:15px;font-weight:400">読み物の本文</p></main></body></html>')
    assert.deepEqual(await page.evaluate(scan), [])
    await page.locator('#small').evaluate(el => { el.style.fontWeight = '400' })
    const broken = await page.evaluate(scan)
    assert.equal(broken.length, 1)
    assert.equal(broken[0].kind, 'thintext')
    assert.deepEqual(broken[0].measure, { size: 12, weight: 400 })
    await page.locator('#small').evaluate(el => { el.style.fontWeight = '500' })
    assert.deepEqual(await page.evaluate(scan), [])
  } finally { await browser.close() }
})

test('操作できる要素の当たり判定がゼロなら落ち、表示を戻すと通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><button id="action" style="width:0;height:36px">保存</button><a href="#" style="display:none">非表示</a></main>')
    const broken = await page.evaluate(scanRowHeights)
    assert.equal(broken.length, 1)
    assert.equal(broken[0].kind, 'zero-control-hit-area')
    assert.deepEqual(broken[0].measure, { width: 0, height: 36 })
    await page.locator('#action').evaluate(el => { el.style.width = '96px' })
    assert.deepEqual(await page.evaluate(scanRowHeights), [])
  } finally { await browser.close() }
})

test('押せない時に灰色へ塗り直す・重ねて薄くする・影や押せる形が残ると落ち、元の見た目のまま薄くすれば通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => !['selection-color', 'tap-highlight'].includes(kind))
    await page.setContent('<style>:root{--o:.48}.b{box-shadow:0 1px 2px #0003;cursor:pointer}.b:disabled{opacity:var(--o);box-shadow:none;cursor:not-allowed}</style><main><button class="b" disabled>保存</button></main>')
    assert.deepEqual(await kinds(), [])
    await page.addStyleTag({ content: '.b:disabled{background-color:#eee}' })
    assert.ok((await kinds()).includes('disabled-repaint'))
    await page.setContent('<style>:root{--o:.48}.b:disabled{opacity:var(--o);box-shadow:0 1px 2px #0003;cursor:not-allowed}</style><main><button class="b" disabled>保存</button></main>')
    assert.ok((await kinds()).includes('disabled-look'))
    await page.setContent('<style>:root{--o:.48}.w{opacity:var(--o)}.b:disabled{opacity:var(--o);cursor:not-allowed}</style><main><div class="w"><button class="b" disabled>保存</button></div></main>')
    assert.ok((await kinds()).includes('disabled-look'))
    await page.setContent('<style>.b:disabled{opacity:.4}</style><main><button class="b" disabled style="cursor:not-allowed">保存</button></main>')
    assert.ok((await kinds()).includes('disabled-opacity'))
  } finally { await browser.close() }
})

test('動きの時間を手書きすると落ち、共通の --motion-* と動きを減らす設定の 0.01ms は通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => !['selection-color', 'tap-highlight'].includes(kind))
    await page.setContent('<style>:root{--motion-fast:120ms}.a{transition:background-color var(--motion-fast) linear}@media (prefers-reduced-motion: reduce){*{transition-duration:.01ms!important}}</style><main><a class="a" href="#">リンク</a></main>')
    assert.deepEqual(await kinds(), [])
    await page.addStyleTag({ content: '.a{transition:background-color 200ms linear}' })
    assert.ok((await kinds()).includes('motion-literal'))
    await page.setContent('<style>:root{--x-spin:.8s}</style><main>本文</main>')
    assert.ok((await kinds()).includes('motion-literal'))
  } finally { await browser.close() }
})

test('動きの曲線を手書きすると落ち、共通の --motion-ease-* と回る印の linear は通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => !['selection-color', 'tap-highlight'].includes(kind))
    await page.setContent('<style>:root{--motion-fast:120ms;--motion-ease-out:cubic-bezier(.22,1,.36,1);--motion-spin:1s}.a{transition:color var(--motion-fast) var(--motion-ease-out)}.s{animation:r var(--motion-spin) linear infinite}@keyframes r{to{rotate:1turn}}</style><main><a class="a" href="#">リンク</a><i class="s"></i></main>')
    assert.deepEqual(await kinds(), [])
    await page.addStyleTag({ content: '.b{animation:none;transition:none}' })
    assert.deepEqual(await kinds(), [])
    await page.addStyleTag({ content: '.a{transition:color var(--motion-fast) ease-out}' })
    assert.ok((await kinds()).includes('motion-curve'))
    await page.setContent('<style>.a{transition-timing-function:cubic-bezier(.2,0,0,1)}</style><main><a class="a" href="#">リンク</a></main>')
    assert.ok((await kinds()).includes('motion-curve'))
    await page.setContent('<style>:root{--motion-ease-out:ease}.a{transition:color .15s var(--motion-ease-out)}</style><main><a class="a" href="#">リンク</a></main>')
    assert.ok((await kinds()).includes('motion-literal'))
  } finally { await browser.close() }
})

test('印が 16・20 以外の大きさや 1.75 以外の線だと落ち、左メニューの 18・空の表示の 40・丸の中のしるしは通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => ['icon-size', 'icon-stroke'].includes(kind))
    const icon = (size, stroke = 1.75, cls = 'lucide') => `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}"><path d="M4 12h16"/></svg>`
    await page.setContent(`<main><button>${icon(16)}保存</button><h2>${icon(20)}見出し</h2><div data-list-state="empty">${icon(40)}</div><span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#087a3e">${icon(10)}</span></main><aside><a class="sidebar_item__x" href="#">${icon(18)}友だち</a></aside>`)
    assert.deepEqual(await kinds(), [])
    await page.setContent(`<main><button>${icon(14)}保存</button></main>`)
    assert.ok((await kinds()).includes('icon-size'))
    await page.setContent(`<main><button>${icon(18)}保存</button></main>`)
    assert.ok((await kinds()).includes('icon-size'))
    await page.setContent(`<main><button>${icon(16, 2)}保存</button></main>`)
    assert.ok((await kinds()).includes('icon-stroke'))
  } finally { await browser.close() }
})

test('共通のボタンの印と文字の間が 8 でないと落ち、8 なら通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => !['selection-color', 'tap-highlight'].includes(kind))
    const button = gap => `<main><button class="button_button__x" style="display:inline-flex;align-items:center;gap:${gap}px"><svg class="lucide" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M4 12h16"/></svg>保存する</button></main>`
    await page.setContent(button(8))
    assert.deepEqual(await kinds(), [])
    await page.setContent(button(6))
    assert.ok((await kinds()).includes('button-icon-gap'))
  } finally { await browser.close() }
})

test('選んだ文字の地・タップの光・画像の幅と高さ・動きを減らす設定の遅れを見張る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const kindsOf = async (page) => (await page.evaluate(scanPolish)).map(f => f.kind)
    const ok = '<style>::selection{background:#087a3e33}html{-webkit-tap-highlight-color:transparent}.t{width:40px;height:40px}:root{--m:1s}.r{transition:opacity var(--m) linear}</style>'
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    await page.setContent(`${ok}<style>@media (prefers-reduced-motion: reduce){*{transition-delay:0s!important}}</style><main><img class="t" width="40" height="40" alt=""><img alt="" style="max-width:100%"><p class="r" style="transition-delay:.2s">本文</p></main>`)
    assert.deepEqual(await kindsOf(page), [])
    await page.setContent(`${ok}<main><img class="t" alt=""></main>`)
    assert.ok((await kindsOf(page)).includes('img-size'))
    await page.setContent(`${ok}<main><p class="r" style="transition-delay:.2s">本文</p></main>`)
    assert.ok((await kindsOf(page)).includes('reduced-motion-delay'))
    await page.setContent('<html data-theme="v8"><body><main>本文</main></body></html>')
    assert.ok((await kindsOf(page)).includes('selection-color'))
    assert.ok((await kindsOf(page)).includes('tap-highlight'))
  } finally { await browser.close() }
})

test('左メニューの件数の札は「名前、33件」と区切って読ませ、札の数字は読ませない', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => kind === 'nav-count-name')
    await page.setContent('<nav><a href="#" aria-label="受信箱、33件"><span>受信箱</span><span aria-hidden="true">33</span></a></nav>')
    assert.deepEqual(await kinds(), [])
    await page.setContent('<nav><a href="#"><span>受信箱</span><span>33</span><span style="position:absolute;width:1px;height:1px;overflow:hidden">33件</span></a></nav>')
    assert.deepEqual(await kinds(), ['nav-count-name'])
  } finally { await browser.close() }
})

test('「？」の押せる範囲が 28 未満・見出しとの間が 8 でないと落ちる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => kind === 'help-tip')
    const tip = (gap, size = 28) => `<main><div style="display:flex;align-items:center;gap:${gap}px"><h2 style="margin:0;font-size:15px">題</h2><span class="help-tip_wrap__x"><button class="help-tip_button__x" style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;margin:-6px;padding:0;border:0;background:none"><svg width="16" height="16" viewBox="0 0 24 24"></svg></button></span></div></main>`
    await page.setContent(tip(8))
    assert.deepEqual(await kinds(), [])
    await page.setContent(tip(14))
    assert.deepEqual(await kinds(), ['help-tip'])
    await page.setContent(tip(8, 20))
    assert.deepEqual(await kinds(), ['help-tip'])
  } finally { await browser.close() }
})

test('状態の札の点と文字の間が 8 でないと落ちる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => kind === 'status-dot-gap')
    const badge = gap => `<style>.status-badge_badge__x{display:inline-flex;align-items:center;gap:${gap}px;padding:2px 8px}.status-badge_badge__x::before{content:'';width:6px;height:6px;border-radius:50%;background:#16a34a}</style><main><span class="status-badge_badge__x">配信中</span></main>`
    await page.setContent(badge(8))
    assert.deepEqual(await kinds(), [])
    await page.setContent(badge(5))
    assert.deepEqual(await kinds(), ['status-dot-gap'])
  } finally { await browser.close() }
})

test('数の帯の数字と単位が同じ下の線に乗っていないと落ちる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => kind === 'kpi-unit-baseline')
    const kpi = align => `<main><p style="display:flex;align-items:${align};gap:3px;margin:0"><span style="display:block;font-size:34px;line-height:36px"><span data-kpi-number>214</span></span><span data-kpi-unit style="font-size:12px;line-height:18px">人</span></p></main>`
    await page.setContent(kpi('baseline'))
    assert.deepEqual(await kinds(), [])
    await page.setContent(kpi('flex-start'))
    assert.deepEqual(await kinds(), ['kpi-unit-baseline'])
  } finally { await browser.close() }
})

test('表の見出しの行がふつうの行より高い・太い、表の中の札の上下が詰まっていると落ちる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => ['table-head', 'table-tag-pad'].includes(kind))
    const table = (headH, weight, pillH) => `<main><table style="border-collapse:collapse;width:300px"><thead><tr style="height:${headH}px"><th style="font:${weight} 12px sans-serif">名前</th></tr></thead><tbody><tr style="height:52px"><td><span class="tag-pill_pill__x" style="display:inline-flex;align-items:center;height:${pillH}px;font:500 12px/16px sans-serif">VIP</span></td></tr></tbody></table></main>`
    await page.setContent(table(40, 500, 24))
    assert.deepEqual(await kinds(), [])
    await page.setContent(table(60, 500, 24))
    assert.deepEqual(await kinds(), ['table-head'])
    await page.setContent(table(40, 600, 24))
    assert.deepEqual(await kinds(), ['table-head'])
    await page.setContent(table(40, 500, 18))
    assert.deepEqual(await kinds(), ['table-tag-pad'])
  } finally { await browser.close() }
})

test('押して開ける行に指の形と乗せた時の地の変化が無いと落ちる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => kind === 'row-open')
    const row = style => `<style>${style}</style><main><table style="width:300px"><tbody><tr data-row-open="true"><td>山田</td></tr></tbody></table></main>`
    await page.setContent(row('tr[data-row-open]{cursor:pointer}tr[data-row-open]:hover{background:#f5f5f7}'))
    assert.deepEqual(await kinds(), [])
    await page.setContent(row('tr[data-row-open]:hover{background:#f5f5f7}'))
    assert.deepEqual(await kinds(), ['row-open'])
    await page.setContent(row('tr[data-row-open]{cursor:pointer}'))
    assert.deepEqual(await kinds(), ['row-open'])
  } finally { await browser.close() }
})

test('押せる所が 24 未満で上下の隣と近いと落ち、透明な当たりで広げるか間が空いていれば通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => kind === 'hit-size')
    const links = extra => `<style>a{display:inline-flex;height:18px;font-size:13px;line-height:18px}${extra}</style><main><nav style="display:flex;flex-direction:column;gap:2px;align-items:flex-start"><a href="#">ホーム</a><a href="#">友だち</a></nav></main>`
    await page.setContent(links(''))
    assert.ok((await kinds()).length > 0)
    await page.setContent(links("a{position:relative}a::before{content:'';position:absolute;inset-inline:0;inset-block:min(0px,calc((100% - 24px) / 2))}"))
    assert.deepEqual(await kinds(), [])
    await page.setContent('<main><p>説明の文の中の <a href="#">リンク</a> は数えない。</p><a href="#" style="display:inline-block;margin:40px">離れた小さなリンク</a></main>')
    assert.deepEqual(await kinds(), [])
  } finally { await browser.close() }
})

test('色の地の箱の中の印が真ん中から 0.5 より離れると落ちる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => kind === 'box-icon-center')
    const box = style => `<main><span style="display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:#e8f8ee;${style}"><svg width="16" height="16" viewBox="0 0 24 24" style="display:block"></svg></span></main>`
    await page.setContent(box(''))
    assert.deepEqual(await kinds(), [])
    await page.setContent(box('padding-top:3px;box-sizing:border-box'))
    assert.deepEqual(await kinds(), ['box-icon-center'])
  } finally { await browser.close() }
})

test('同じ種類のカードの右上の操作の位置がそろっていないと落ちる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => kind === 'card-corner')
    const card = top => `<article class="c" style="position:relative;width:240px;height:120px"><button style="position:absolute;right:16px;top:${top}px;width:28px;height:28px">…</button></article>`
    await page.setContent(`<main><div style="display:flex;gap:16px">${card(16)}${card(16)}</div></main>`)
    assert.deepEqual(await kinds(), [])
    await page.setContent(`<main><div style="display:flex;gap:16px">${card(16)}${card(20)}</div></main>`)
    assert.deepEqual(await kinds(), ['card-corner'])
  } finally { await browser.close() }
})

test('印と 1 行の文字の上下の真ん中が 0.5 より離れる・札が文字にかぶると落ちる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => ['icon-text-center', 'badge-overlap'].includes(kind))
    const button = shift => `<main><button style="display:inline-flex;align-items:center;gap:8px;height:36px;font:500 13px/20px sans-serif"><svg width="16" height="16" viewBox="0 0 24 24" style="translate:0 ${shift}px"></svg><span>保存する</span></button></main>`
    await page.setContent(button(0))
    assert.deepEqual(await kinds(), [])
    await page.setContent(button(3))
    assert.deepEqual(await kinds(), ['icon-text-center'])
    await page.setContent('<main><a href="#" style="position:relative;display:block;width:120px"><span>受信箱のお知らせ</span><span class="nav_badge__x" style="position:absolute;left:20px;top:0">33</span></a></main>')
    assert.deepEqual(await kinds(), ['badge-overlap'])
  } finally { await browser.close() }
})

test('余白の段にない padding・margin・gap・余白の変数を書くと落ちる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => kind === 'space-scale')
    await page.setContent('<style>:root{--x-pad:12px 16px}.a{padding:8px 12px;margin:-24px;gap:36px;padding-top:calc(100% - 13px)}</style><main><p class="a">本文</p></main>')
    assert.deepEqual(await kinds(), [])
    await page.addStyleTag({ content: '.a{padding:9px 12px}' })
    assert.ok((await kinds()).length > 0)
    await page.setContent('<style>:root{--x-gap:13px}</style><main>本文</main>')
    assert.deepEqual(await kinds(), ['space-scale'])
  } finally { await browser.close() }
})

test('Tailwind の disabled: の書き足しは、共通の規則が上書きして見た目どおりなら数えない', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => kind.startsWith('disabled'))
    const css = '@layer utilities{.disabled\\:opacity-50:disabled{opacity:.5}}:root{--o:.48}html:root button:disabled{opacity:var(--o);box-shadow:none;cursor:not-allowed}'
    await page.setContent(`<style>${css}</style><main><button class="disabled:opacity-50" disabled>保存</button></main>`)
    assert.deepEqual(await kinds(), [])
    await page.setContent(`<style>${css.replace('@layer utilities{', '{').replace('{.disabled', '.disabled').replace('.5}}', '.5}')}</style><main><button class="disabled:opacity-50" disabled>保存</button></main>`)
    assert.ok((await kinds()).includes('disabled-opacity'))
  } finally { await browser.close() }
})

test('手書きの動きを同じ選び先の後ろの規則で共通の値に書き直していれば数えない', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => kind.startsWith('motion'))
    await page.setContent('<style>:root{--m:120ms;--e:ease}.c{transition:color 120ms ease-out}.c{transition:color var(--m) var(--e)}</style><main><a class="c" href="#">リンク</a></main>')
    assert.deepEqual(await kinds(), [])
    await page.setContent('<style>:root{--m:120ms;--e:ease}.c{transition:color var(--m) var(--e)}.c{transition:color 120ms ease-out}</style><main><a class="c" href="#">リンク</a></main>')
    assert.ok((await kinds()).length > 0)
  } finally { await browser.close() }
})

test('同じ段の押せるもの同士の外枠が 1px でも重なると落ち、間を空ける・欄の中の印・別の層は通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scan)).filter(f => f.kind === 'control-collide')
    const row = gap => `<main><div style="display:flex;gap:${gap}"><select aria-label="予約元" style="width:140px;height:36px"><option>予約元：すべて</option></select><button id="print" style="width:72px;height:36px">印刷</button></div></main>`
    await page.setContent(row('8px'))
    assert.deepEqual(await kinds(), [])
    await page.setContent(row('0px'))
    assert.deepEqual(await kinds(), [])
    await page.locator('#print').evaluate(el => { el.style.marginLeft = '-1px' })
    const broken = await kinds()
    assert.equal(broken.length, 1)
    assert.deepEqual(broken[0].measure, { width: 1, height: 36 })
    // 欄の中に収めた消すボタンは欄の内側なので数えない。
    await page.setContent('<main><div style="position:relative;width:240px"><input aria-label="探す" style="width:240px;height:36px;box-sizing:border-box"><button aria-label="消す" style="position:absolute;right:4px;top:4px;width:28px;height:28px">×</button></div></main>')
    assert.deepEqual(await kinds(), [])
    // 下に追従する帯の中のボタンと、帯の裏の本文のボタンは別の層。
    await page.setContent('<main><button style="height:36px;width:200px;margin-top:800px">本文</button><div style="position:fixed;bottom:0;left:0;right:0"><button style="height:36px;width:200px">保存する</button></div></main>')
    await page.setViewportSize({ width: 800, height: 830 })
    assert.deepEqual(await kinds(), [])
  } finally { await browser.close() }
})

test('ボタンが丸ごと重なる場合も落ち、カードの外へ出た操作を検出する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><article style="width:200px"><div style="display:flex"><button style="width:120px;flex:none">見送る</button><button style="width:120px;flex:none">採用する</button></div></article></main>')
    assert.ok((await page.evaluate(scan)).some(f => f.kind === 'card-control-overflow'))
    await page.setContent('<main><div style="position:relative"><button style="width:120px">予約元</button><button style="position:absolute;left:0;top:0;width:120px">印刷</button></div></main>')
    assert.ok((await page.evaluate(scan)).some(f => f.kind === 'control-collide'))
    await page.setContent('<main><article style="width:200px"><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px"><button style="min-width:0">見送る</button><button style="min-width:0">採用する</button></div></article></main>')
    assert.ok(!(await page.evaluate(scan)).some(f => /card-control|control-collide/.test(f.kind)))
  } finally { await browser.close() }
})

test('主操作の置き場所と題の副操作は、壊すと落ち、戻すと通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><div data-page-template="list"><header data-template-region="heading"><div data-page-heading-actions><button data-variant="primary">作る</button><button data-variant="secondary">CSV</button></div></header><div data-list-folders="true"><aside data-template-region="folders">フォルダ</aside></div></div></main>')
    const kinds = async () => (await page.evaluate(scan)).map(f => f.kind)
    assert.ok((await kinds()).includes('create-action-placement'))
    assert.ok((await kinds()).includes('heading-secondary-style'))
    await page.locator('[data-variant="secondary"]').evaluate(el => { el.dataset.variant = 'text' })
    await page.locator('aside').evaluate(el => el.append(document.querySelector('[data-variant="primary"]')))
    assert.deepEqual(await kinds(), [])
    await page.locator('[data-list-folders]').evaluate(el => { el.dataset.listFolders = 'false' })
    assert.ok((await kinds()).includes('create-action-placement'))
    await page.locator('[data-page-heading-actions]').evaluate(el => el.append(document.querySelector('[data-variant="primary"]')))
    assert.deepEqual(await kinds(), [])
  } finally { await browser.close() }
})

test('1つの操作の段で高さが違う操作が並ぶと落ち、36pxにそろえれば通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><div data-control-row style="display:flex;gap:8px;align-items:center"><button id="prev" style="height:32px">前へ</button><button style="height:36px">今日</button><select aria-label="状態" style="height:36px"><option>すべて</option></select></div></main>')
    const broken = await page.evaluate(scanRowHeights)
    assert.equal(broken.length, 1)
    assert.equal(broken[0].kind, 'rowheight')
    assert.deepEqual(broken[0].measure.heights, [32, 36, 36])
    await page.locator('#prev').evaluate(el => { el.style.height = '36px' })
    assert.deepEqual(await page.evaluate(scanRowHeights), [])
  } finally { await browser.close() }
})

test('ダイアログ・カード・下の帯で影が親の overflow に切られると落ち、逃げを作れば通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const html = overflow => `<main><section role="dialog"><div id="clip" style="position:relative;width:240px;height:64px;overflow:${overflow}"><button style="position:absolute;left:8px;top:40px;width:180px;height:36px;box-shadow:0px 0px 8px 0px rgba(0,0,0,.3)">詳しい数値を見る</button></div></section></main>`
    await page.setContent(html('hidden'))
    const clipped = (await page.evaluate(scan)).filter(f => f.kind === 'shadow-clip')
    assert.equal(clipped.length, 1)
    assert.ok(clipped[0].measure.bottom > 0)
    await page.locator('#clip').evaluate(el => { el.style.height = '96px'; el.style.overflow = 'visible' })
    assert.deepEqual((await page.evaluate(scan)).filter(f => f.kind === 'shadow-clip'), [])

    await page.setContent(html('auto'))
    assert.equal((await page.evaluate(scan)).filter(f => f.kind === 'shadow-clip').length, 1)
  } finally { await browser.close() }
})

test('吹き出しが画面の題に重なる配置を検出し、どかせば通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><h2 style="position:absolute;left:40px;top:40px;width:120px;height:24px">親アカウント</h2><span role="tooltip" style="position:fixed;left:50px;top:45px;width:100px;height:30px">説明</span></main>')
    const overlap = async () => (await page.evaluate(scan)).filter(f => f.kind === 'tooltip-heading-overlap')
    assert.equal((await overlap()).length, 1)
    await page.locator('[role="tooltip"]').evaluate(el => { el.style.top = '5px' })
    assert.deepEqual(await overlap(), [])
  } finally { await browser.close() }
})
