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

test('押せない時に灰色へ塗り直す・重ねて薄くする・影や押せる形が残ると落ち、元の見た目のまま薄くすれば通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind)
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
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind)
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
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind)
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
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind)
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
    const kinds = async () => (await page.evaluate(scanPolish)).map(f => f.kind)
    const button = gap => `<main><button class="button_button__x" style="display:inline-flex;align-items:center;gap:${gap}px"><svg class="lucide" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M4 12h16"/></svg>保存する</button></main>`
    await page.setContent(button(8))
    assert.deepEqual(await kinds(), [])
    await page.setContent(button(6))
    assert.ok((await kinds()).includes('button-icon-gap'))
  } finally { await browser.close() }
})
