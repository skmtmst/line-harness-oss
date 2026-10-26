import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './owner-rules-browser.mjs'
import scanPolish from './polish-rules-browser.mjs'

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
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind).filter(kind => !['selection-color', 'tap-highlight'].includes(kind))
    const icon = (size, stroke = 1.75, cls = 'lucide') => `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}"><path d="M4 12h16"/></svg>`
    await page.setContent(`<main><button>${icon(16)}保存</button><h2>${icon(20)}見出し</h2><div data-list-state="empty">${icon(40)}</div><span style="display:inline-flex;width:16px;height:16px;border-radius:50%;background:#087a3e">${icon(10)}</span></main><aside><a class="sidebar_item__x" href="#">${icon(18)}友だち</a></aside>`)
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
