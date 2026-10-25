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
