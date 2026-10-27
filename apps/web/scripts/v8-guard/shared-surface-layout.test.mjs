import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect } from '@playwright/test'
import { connectGuardBrowser } from './browser-session.mjs'
import { compileUiStyles } from './compile-ui-styles.mjs'
import { measureControlCentering } from '../../../../scripts/visual-qa/control-centering.mjs'

const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(fromVitest.resolve('vite'))('esbuild')

const webRoot = new URL('../..', import.meta.url).pathname
const sheets = new Set()
const compiled = await build({
  stdin: { resolveDir: webRoot, loader: 'tsx', contents: `
import React,{useState,useRef} from 'react'; import {createRoot} from 'react-dom/client';
import {Steps} from './src/components/templates/steps';
import {PageHeading} from './src/components/templates/page-frame';
import Checkbox,{SettingCheckbox} from './src/components/shared/checkbox';
import CheckCard from './src/components/shared/check-card';
import Radio from './src/components/shared/radio';
import Toggle from './src/components/shared/toggle';
import {DataTable,TableHeadRow,Th,Tr,Td} from './src/components/shared/table';
import {FolderDotName} from './src/components/shared/folder-dot';
import Dialog from './src/components/shared/dialog';
import ConfirmDialog from './src/components/shared/confirm-dialog';
import Drawer from './src/components/shared/drawer';
import Button from './src/components/shared/button';
import ActionMenu from './src/components/shared/action-menu';
import StickyBar from './src/components/shared/sticky-bar';
import CommandPalette from './src/components/shared/command-palette';
import Notice from './src/components/shared/notice';
import {DialogContentRow} from './src/components/shared/dialog-form-row';
import {EntityPickerField} from './src/components/shared/entity-picker';
import KpiBand from './src/components/shared/kpi-band';
import KpiCard from './src/components/shared/kpi-card';
function Fixture(){
 const [menuOpen,setMenuOpen]=useState(false),menuAnchor=useRef(null);
 const reasonFault=globalThis.inputReasonFault;
 const [window,setWindow]=useState(''),[value,setValue]=useState(false),[current,setCurrent]=useState('now'),[failureCalls]=useState({});
 const steps=[{key:'done',label:'事前確認',state:'done',onSelect:()=>setCurrent('done')},{key:'now',label:'アカウント接続',state:'current'}, {key:'next',label:'接続確認',state:'todo'}, {key:'choice',label:'使い方を選ぶ',state:'todo'}, {key:'finish',label:'完了',state:'todo'}];
 const props={open:!!window,onCancel:()=>setWindow(''),onConfirm:()=>setWindow(''),title:'新しく作る',description:'名前を入力してください。内容は作成する前に確認できます。',headerIcon:<svg viewBox="0 0 16 16"><path d="M2 2h12v12H2z" fill="none" stroke="currentColor"/></svg>};
 return <main><CommandPalette items={[{href:"/friends",label:"友だち一覧"}]}/>
  <PageHeading title="LINEアカウントを登録" steps={<Steps label="登録の手順" steps={steps} currentKey={current}/>}/>
  <section id="selection"><DataTable cellPresentation="friends"><thead><TableHeadRow><Th columnKind="selection"><Checkbox aria-label="全選択" checked={value} onCheckedChange={setValue}/></Th><Th><Checkbox aria-label="見出しの選択" checked={value} onCheckedChange={setValue}/>タイトル・内容</Th></TableHeadRow></thead><tbody><Tr><Td columnKind="selection"><Checkbox aria-label="行を選ぶ" checked={value} onCheckedChange={setValue}/></Td><Td><FolderDotName selection={<Checkbox aria-label="名前の前の選択" checked={value} onCheckedChange={setValue}/>}>一斉配信の名前</FolderDotName></Td></Tr></tbody></DataTable>
  <DataTable><thead><TableHeadRow><Th>設定</Th></TableHeadRow></thead><tbody><Tr><Td><Toggle label="表の切り替え" checked={value} onChange={setValue}/></Td></Tr></tbody></DataTable><div data-center-row><SettingCheckbox label="設定" checked={value} onChange={setValue}/></div>
  <div data-center-row><Checkbox checked={value} onCheckedChange={setValue}>ラベル付き</Checkbox></div>
  <CheckCard title="確認行" size="row" checked={value} onChange={setValue}/>
  <CheckCard title="カード" checked={value} onChange={setValue}/>
  <div data-center-row><Radio name="channel" checked={value} onChange={()=>setValue(!value)}>ラジオ</Radio></div>
  <div data-center-row><Toggle label="切り替え" checked={value} onChange={setValue}/></div></section>
  <section id="entity-selection"><EntityPickerField label="親候補" noun="アカウント" items={Array.from({length:20},(_,i)=>({id:String(i),name:"親候補"+i,meta:"候補の説明"}))} value="0" onChange={()=>{}} /></section>
  <section id="notices" style={{maxWidth:720}}>
   <Notice tone="info" heading="回復コードが残っていません" message="認証アプリが使えない時に入れなくなる前に、作り直してください。" action={<Button>作り直す</Button>} onClose={()=>{}}/>
   <Notice tone="warn" heading="いつもと違う端末・場所からのログインです。心当たりがなければ、ほかの端末のログインを終えてパスワードを変えてください" message="大事な操作の前に毎回、本人確認をします。" action={<Button>ログイン中の端末を見る</Button>} onClose={()=>{}}/>
   <Notice tone="warn" heading="ほかの人がこの内容を保存しました" message="読み直すと、ほかの人の変更を見てから続けられます。" states={[{label:'済み',state:'done'},{label:'未保存',state:'pending'}]} footer={<button type="button">入力を破棄する</button>} action={<><Button>読み直す</Button><Button variant="primary">上書きする</Button></>} onClose={()=>{}}/>
   <Notice tone="info" action={<Button>開く</Button>} onClose={()=>{}}>題のない1行の知らせです。</Notice>
  </section>
  {[852,1140].map(w=><section key={w} data-kpi-fixture={w} style={{width:w}}><KpiBand appearance="cards">
   <KpiCard presentation="band" title="対応が必要な受信" icon={<svg viewBox="0 0 16 16"/>} value={5} unit="件" badge="最長 6日前" badgeTone="danger" detail="LINE 1・メール 4" action={{label:'受信箱へ',href:'/chats'}}/>
   <KpiCard presentation="band" title="今日の友だち" icon={<svg viewBox="0 0 16 16"/>} value={3} unit="人" detail="ブロック 0 人" sparkline={[1,2,2,3]}/>
   <KpiCard presentation="band" title="接続に問題" icon={<svg viewBox="0 0 16 16"/>} value={12345} unit="通" valueTone="warning" detail="枠 200 通のうち 2%" action={{label:'配信へ',href:'/broadcasts'}}/>
   <KpiCard presentation="band" title="今日の予約" icon={<svg viewBox="0 0 16 16"/>} value={0} unit="件" badge="なし" badgeTone="neutral" detail="次の予定はありません" action={{label:'予約へ',href:'/booking'}}/>
  </KpiBand></section>)}
  <section id="saving-bars">{[false,true,'input'].map(info=><StickyBar key={String(info)} status="未保存" info={info===true?<span>幅1200 × 高さ628</span>:null} destructive={<Button>削除する</Button>} actions={<><Button disabled={info==='input'} disabledReason={info==='input'?'名前を入れてください':undefined}>キャンセル</Button><Button variant="primary" disabled={info==='input'} disabledReason={info==='input'?'名前を入れてください':undefined}>保存する</Button></>}/>)}</section>
  {['normal','split','inline'].map(mode=><section key={mode} data-failing-bar={mode}><input aria-label="失敗時にも保持する入力" defaultValue="残す内容"/><StickyBar split={mode==='split'?{lead:<span>別の一覧</span>,trailingWidth:'360px'}:undefined} presentation={mode==='inline'?'distribution':undefined} actions={<><Button>キャンセル</Button><Button variant="primary" onClick={()=>{failureCalls[mode]=(failureCalls[mode]||0)+1;globalThis.failureCalls=failureCalls[mode];if(failureCalls[mode]===1)throw new Error('offline')}}>失敗を確かめる</Button></>}/></section>)}
  <section id="input-action"><Button disabled disabledReason="名前を入れてください" lockedReason={reasonFault?"名前を入れてください":undefined}>入力を保存する</Button></section>
  <section id="permission-action"><Button variant="primary" lockedReason="統括の担当者だけが作れます" onClick={()=>{globalThis.permissionCalls=(globalThis.permissionCalls||0)+1}}>送り先を作る</Button><Button count={3}>絞り込み</Button></section>
  <section id="permission-menu"><button ref={menuAnchor} onClick={()=>setMenuOpen(!menuOpen)}>権限メニュー</button><ActionMenu open={menuOpen} anchorRef={menuAnchor} onClose={()=>setMenuOpen(false)} items={[
   {id:'locked',label:'権限の操作',group:'destructive',lockedReason:'統括の担当者だけが作れます',href:'/unexpected',onSelect:()=>{globalThis.menuLockedCalls=(globalThis.menuLockedCalls||0)+1}},
   {id:'input',label:'入力不足の操作',group:'destructive',disabled:true,disabledReason:'名前を入れてください',onSelect:()=>{globalThis.menuInputCalls=(globalThis.menuInputCalls||0)+1}},
   {id:'allowed',label:'許可の操作',group:'destructive',onSelect:()=>{globalThis.menuAllowedCalls=(globalThis.menuAllowedCalls||0)+1}}
  ]}/></section>
  <section id="windows">{['通常','確認','危険','警告','手順','選択','長文','引き出し'].map(name=><Button key={name} onClick={()=>setWindow(name)}>{name}</Button>)}</section>
  {window==='引き出し'?<Drawer open title="設定を編集する" headerIcon={props.headerIcon} description={props.description} onClose={()=>setWindow('')} footer={<Button onClick={()=>setWindow('')}>保存する</Button>}><input aria-label="名前" defaultValue="保持する名前"/></Drawer>:
   ['確認','危険','警告'].includes(window)?<ConfirmDialog {...props} title="内容を確認しますか？" destructive={window==='危険'} warning={window==='警告'}/>:
   <Dialog {...props} open={!!window} widthPreset={window==='選択'?'picker':undefined} steps={window==='手順'?<Steps label="窓の手順" steps={steps} currentKey="now"/>:null}>
    <DialogContentRow tone="muted"><label>名前<input aria-label="名前" defaultValue="保持する名前"/></label></DialogContentRow><Notice tone="warn">入力した内容を確認してください。</Notice>{window==='長文'?<div style={{height:1600}}>長い内容</div>:null}
   </Dialog>}
 </main>
}createRoot(document.getElementById('root')).render(<Fixture/>);

  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: `${webRoot}/tsconfig.json`, define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"http://127.0.0.1:8788"' },
  plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }))
    b.onResolve({ filter: /^@\/contexts\/account-context$/ }, () => ({ path: 'account', namespace: 'fixture' }))
    b.onResolve({ filter: /^next\/link$|^@\/components\/shared\/list-navigation$/ }, () => ({ path: 'link', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'navigation'
      ? 'export const useRouter=()=>({push(){},replace(){},prefetch(){}});export const usePathname=()=>"/fixture";export const useSearchParams=()=>new URLSearchParams();'
      : args.path === 'account' ? 'export const useOptionalAccount=()=>null;export const useAccount=()=>({selectedAccountId:null,selectedAccount:null});'
      : 'import React from "react";export default function Link(p){return React.createElement("a",p)}', resolveDir: webRoot }))
    b.onLoad({ filter: /\.module\.css$/ }, args => {
      let css = readFileSync(args.path, 'utf8')
      const globals = []
      css = css.replace(/:global\(([^()]*)\)/g, (_, selector) => `GLOBAL_SELECTOR_${globals.push(selector) - 1}`)
      const names = Object.fromEntries([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map(m => [m[1], m[1]]))
      const prefix = `fixture_${sheets.size}_`
      for (const name of Object.keys(names)) names[name] = prefix + name
      css = css.replace(/\.([A-Za-z][\w-]*)/g, (_, name) => `.${names[name]}`)
        .replace(/GLOBAL_SELECTOR_(\d+)/g, (_, index) => globals[Number(index)])
      sheets.add(css)
      return { contents: `export default ${JSON.stringify(names)}`, loader: 'js' }
    })
    b.onLoad({ filter: /\.css$/ }, args => { sheets.add(readFileSync(args.path, 'utf8')); return { contents: '', loader: 'js' } })
  } }],
})
const globals = await compileUiStyles(new URL('../../src/app/globals.css', import.meta.url).pathname, ['fixed', 'min-w-0'])
const css = [globals, ...sheets].join('\n').replace(/:global\(([^()]*)\)/g, '$1')

async function mount(page, width, inputReasonFault = false) {
  await page.setViewportSize({ width, height: 900 })
  await page.setContent(`<html data-theme="v8"><style>${css}*{box-sizing:border-box}body{margin:0}main{margin:24px 24px 24px 264px}#selection{margin-top:24px}#windows{display:flex;gap:8px}[data-center-row]{height:40px;display:flex;align-items:center}#selection>label{margin-block:12px}</style><div id="root"></div></html>`)
  await page.addScriptTag({ content: `globalThis.inputReasonFault=${JSON.stringify(inputReasonFault)};` + compiled.outputFiles[0].text })
  await page.getByRole('button', { name: '通常', exact: true }).waitFor()
}

test('権限メニューは理由と焦点を保ち、実キー・タップでも起動しない', async () => {
  const browser = await connectGuardBrowser()
  const page = await browser.newPage({ hasTouch: true })
  try {
    for (const width of [1152, 1440]) {
      await mount(page, width)
      await page.evaluate(() => { globalThis.menuLockedCalls = 0; globalThis.menuInputCalls = 0; globalThis.menuAllowedCalls = 0 })
      const trigger = page.getByRole('button', { name: '権限メニュー', exact: true })
      await trigger.click()
      const locked = page.getByRole('menuitem', { name: /^権限の操作/ })
      const allowed = page.getByRole('menuitem', { name: '許可の操作', exact: true })
      await expect(locked).toBeFocused()
      await locked.evaluate(async el => {
        const portal = el.closest('[data-menu-portal]')
        await Promise.all(portal.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
      })
      assert.equal(await locked.evaluate(el => getComputedStyle(el.closest('[data-menu-portal]')).position), 'fixed')
      await expect(locked).toHaveAttribute('aria-disabled', 'true')
      assert.deepEqual(await locked.evaluate(el => ({ tag: el.tagName, disabled: el.disabled, href: el.getAttribute('href') })), { tag: 'BUTTON', disabled: false, href: null })
      const lockStyle = await locked.evaluate(el => ({ height: el.getBoundingClientRect().height, color: getComputedStyle(el).color, icon: getComputedStyle(el.querySelector('svg').parentElement).color, reasonHidden: document.getElementById(el.getAttribute('aria-describedby')).hidden }))
      assert.equal(lockStyle.height, await allowed.evaluate(el => el.getBoundingClientRect().height))
      assert.equal(lockStyle.color, lockStyle.icon)
      assert.equal(lockStyle.reasonHidden, true)
      await expect(page.getByRole('tooltip')).toHaveText('統括の担当者だけが作れます')
      if (process.env.V8_GUARD_ARTIFACT_DIR) {
        mkdirSync(process.env.V8_GUARD_ARTIFACT_DIR, { recursive: true })
        await page.screenshot({ path: `${process.env.V8_GUARD_ARTIFACT_DIR}/permission-menu-${width}.png` })
      }
      await page.keyboard.press('Enter')
      await page.keyboard.press('Space')
      const tapRect = await locked.boundingBox()
      assert.ok(tapRect)
      assert.ok(tapRect.x >= 0 && tapRect.y >= 0 && tapRect.x + tapRect.width <= width && tapRect.y + tapRect.height <= 900)
      assert.equal(await locked.evaluate(el => { const rect = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }), true)
      await page.touchscreen.tap(tapRect.x + tapRect.width / 2, tapRect.y + tapRect.height / 2)
      assert.equal(await page.evaluate(() => globalThis.menuLockedCalls || 0), 0)
      assert.equal(await page.evaluate(() => location.pathname), 'blank')
      await page.keyboard.press('ArrowDown')
      await expect(allowed).toBeFocused()
      await page.keyboard.press('Home')
      await expect(locked).toBeFocused()
      await page.keyboard.press('End')
      await expect(allowed).toBeFocused()
      await page.keyboard.press('ArrowUp')
      await expect(locked).toBeFocused()
      await trigger.focus()
      await expect(page.getByRole('tooltip')).toHaveCount(0)
      await locked.hover()
      await expect(page.getByRole('tooltip')).toHaveText('統括の担当者だけが作れます')
      const reason = await locked.evaluate(el => document.getElementById(el.getAttribute('aria-describedby'))?.textContent)
      assert.equal(reason, '統括の担当者だけが作れます')
      await allowed.click()
      assert.equal(await page.evaluate(() => globalThis.menuAllowedCalls || 0), 1)
      assert.equal(await page.evaluate(() => globalThis.menuInputCalls || 0), 0)
    }
  } finally { await page.close(); await browser.close() }
})

test('入力理由の既定を権限tooltipへ戻す故障を検出する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    const inspect = () => page.locator('#input-action').evaluate(host => {
      const button = host.querySelector('button')
      return { disabled: button.disabled, permission: button.hasAttribute('data-permission-locked'), inline: host.querySelector('[role="status"]')?.textContent }
    })
    const conforms = row => row.disabled && !row.permission && row.inline === '名前を入れてください'
    await mount(page, 1152)
    assert.equal(conforms(await inspect()), true)
    // 以前の誤った既定を再現：入力理由までlockedReasonとして解釈する。
    await mount(page, 1152, true)
    const fault = await inspect()
    assert.equal(fault.disabled, false)
    assert.equal(fault.permission, true)
    assert.equal(conforms(fault), false)
  } finally { await browser.close() }
})

for (const width of [1024, 1152, 1440]) {
  test(`補足付きの保存帯も操作を中央に置き、権限の灰ボタンと条件数を保つ ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ reducedMotion: 'reduce' })
      await mount(page, width)
      const offsets = () => page.locator('#saving-bars [data-shared-part="sticky-bar"]').evaluateAll(bars => bars.map(bar => {
        const b = bar.getBoundingClientRect(), a = bar.querySelector('[data-sticky-actions]').getBoundingClientRect()
        return { center: Math.abs(a.left + a.width / 2 - b.left - b.width / 2), overflow: bar.scrollWidth - bar.clientWidth }
      }))
      assert.ok((await offsets()).every(row => row.center <= 0.5 && row.overflow === 0), JSON.stringify(await offsets()))
      const fault = await page.addStyleTag({ content: '#saving-bars [data-shared-part="sticky-bar"]{display:flex!important;justify-content:flex-end!important}' })
      assert.ok((await offsets()).some(row => row.center > 1))
      await fault.evaluate(el => el.remove())
      assert.ok((await offsets()).every(row => row.center <= 0.5))
      for (const mode of ['normal', 'split', 'inline']) {
      const failing = page.locator(`[data-failing-bar="${mode}"]`)
      const actionCenter = () => failing.evaluate(host => {
        const barElement = host.querySelector('[data-shared-part="sticky-bar"]')
        const bar = (barElement.querySelector('[data-sticky-actions]')?.parentElement !== barElement ? barElement.querySelector('[data-sticky-actions]')?.parentElement ?? barElement : barElement).getBoundingClientRect()
        const buttons = [...host.querySelectorAll('button')].map(el => el.getBoundingClientRect())
        const error = host.querySelector('[role="alert"]')?.getBoundingClientRect()
        return { center: Math.abs((buttons[0].left + buttons[1].right) / 2 - (bar.left + bar.width / 2)), top: buttons[0].top - buttons[1].top, errorBelow: !error || error.top >= Math.max(...buttons.map(button => button.bottom)) }
      })
      const before = await actionCenter()
      assert.equal(await failing.getByRole('alert').count(), 0)
      await failing.getByRole('button', { name: '失敗を確かめる' }).click()
      await expect(failing.getByRole('alert')).toContainText('処理できませんでした')
      const after = await actionCenter()
      assert.ok(await failing.evaluate(host => host.querySelector('[role="alert"]').getBoundingClientRect().top >= Math.max(...[...host.querySelectorAll('button')].map(el => el.getBoundingClientRect().bottom))))
      assert.ok(after.center <= 0.5 && after.top === 0, JSON.stringify({ before, after }))
      const errorFault = await page.addStyleTag({ content: `[data-failing-bar="${mode}"] [data-sticky-actions],[data-failing-bar="${mode}"] [data-shared-part="sticky-bar"][data-presentation]{flex-wrap:nowrap!important}[data-failing-bar="${mode}"] [data-button-error]{flex-basis:auto!important;width:auto!important}` })
      const broken = await actionCenter()
      assert.ok(broken.center > 0.5 || broken.top !== 0 || !broken.errorBelow, JSON.stringify({mode, broken}))
      await errorFault.evaluate(el => el.remove())
      assert.ok((await actionCenter()).center <= 0.5)
      await expect(failing.getByRole('textbox')).toHaveValue('残す内容')
      await failing.getByRole('button', { name: '失敗を確かめる' }).click()
      await expect(failing.getByRole('alert')).toHaveCount(0)
      assert.equal(await page.evaluate(() => globalThis.failureCalls), 2)
      }
      const button = page.getByRole('button', { name: '送り先を作る', exact: true })
      const grey = await button.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, disabled: el.disabled }))
      assert.equal(grey.disabled, false)
      const channels = grey.bg.match(/[\d.]+/g).slice(0, 3).map(Number)
      assert.ok(Math.max(...channels) - Math.min(...channels) <= 20, JSON.stringify(grey))
      await button.focus()
      await expect(page.getByRole('tooltip')).toHaveText('統括の担当者だけが作れます')
      await button.press('Enter')
      await button.press('Space')
      await button.dispatchEvent('click')
      assert.equal(await page.evaluate(() => globalThis.permissionCalls || 0), 0)
      assert.equal(await page.locator('#saving-bars [role="status"]').count(), 1)
      assert.equal(await button.getAttribute('aria-disabled'), 'true')
      assert.equal(await page.getByLabel('3件の条件').textContent(), '3')
      if (process.env.V8_GUARD_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.V8_GUARD_ARTIFACT_DIR}/shared-permission-count-${width}.png` })
    } finally { await browser.close() }
  })
}

for (const width of [1152,1440,1920]) {
  test(`EntityPickerの選択印は行内中央で、最後の候補まで表示する ${width}`, async () => {
    const browser=await connectGuardBrowser()
    try {
      const page=await browser.newPage({reducedMotion:'reduce'})
      await mount(page,width)
      await page.getByRole('button',{name:'親候補：変える',exact:true}).click()
      const dialog=page.getByRole('dialog',{name:'アカウントを選ぶ'})
      await dialog.waitFor()
      const radios=dialog.getByRole('radio')
      assert.equal(await radios.count(),20)
      const last=radios.last()
      await last.scrollIntoViewIfNeeded()
      const geometry=await last.evaluate(el=>{const row=el.closest('label'),r=row.getBoundingClientRect(),b=el.getBoundingClientRect();return {dy:b.y+b.height/2-r.y-r.height/2,contained:b.bottom<=r.bottom&&b.right<=r.right,marks:row.querySelectorAll('input[type="radio"]').length}})
      assert.ok(Math.abs(geometry.dy)<=1,JSON.stringify(geometry))
      assert.ok(geometry.contained,JSON.stringify(geometry))
      assert.equal(geometry.marks,1)
      await last.check()
      assert.equal(await last.isChecked(),true)
      const bounds=await last.evaluate(el=>({y:el.getBoundingClientRect().y,height:innerHeight}))
      assert.ok(bounds.y>=0&&bounds.y<bounds.height,JSON.stringify(bounds))
    } finally { await browser.close() }
  })

  test(`手順は名前を丸の下に置き、状態と接続と戻る操作を保つ ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ reducedMotion: 'reduce' })
      await mount(page,width)
      const measure = () => page.locator('[data-part="steps"]').first().evaluate(nav => {
        const dots=[...nav.querySelectorAll('[data-step-dot]')],names=[...nav.querySelectorAll('[data-step-name]')]
        const box=el=>el.getBoundingClientRect(),style=el=>getComputedStyle(el)
        return {dots:dots.map(el=>({state:el.dataset.stepDot,size:box(el).width,background:style(el).backgroundColor,color:style(el).color,ring:style(el).boxShadow})),
          positions:dots.map((el,i)=>({below:box(names[i]).top>=box(el).bottom,center:Math.abs(box(names[i]).left+box(names[i]).width/2-box(el).left-box(el).width/2)})),
          lines:[...nav.querySelectorAll('[data-step-line]')].map(el=>({state:el.dataset.stepLine,offset:Math.abs(box(el).top+box(el).height/2-box(dots[0]).top-box(dots[0]).height/2)})),
          overflow:nav.scrollWidth-nav.clientWidth}
      })
      const result=await measure()
      assert.equal(result.overflow,0)
      assert.ok(result.positions.every(row=>row.below && row.center<=0.5),JSON.stringify(result))
      assert.ok(result.dots.every(row=>row.size>=24 && row.size<=28))
      assert.ok(result.dots[1].ring.includes('2px'))
      assert.notEqual(result.dots[0].background,result.dots[1].background)
      assert.notEqual(result.dots[1].color,result.dots[2].color)
      assert.ok(result.lines.every(row=>row.offset<=0.5))
      assert.deepEqual(result.lines.map(row=>row.state),['done','todo','todo','todo'])
      await page.getByRole('button',{name:'事前確認に戻る'}).focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.locator('[aria-current="step"]').textContent(),'1事前確認')
    } finally { await browser.close() }
  })

  test(`選択の箱をセル・行・名前の中心にそろえる ${width}`,async()=>{
    const browser=await connectGuardBrowser()
    try {
      const page=await browser.newPage({reducedMotion:'reduce'})
      await mount(page,width)
      const measure=()=>page.locator('#selection').evaluate(root=>[...root.querySelectorAll('input,button[role="switch"]')].map(input=>{
        const label=input.closest('label'),cell=input.closest('th,td'),row=input.closest('[data-center-row]')
        const target=cell??(label?.querySelector('[class*="title"], [class*="label"]')??row??label)
        const a=input.getBoundingClientRect(),b=target.getBoundingClientRect()
        return {label:input.getAttribute('aria-label')??label?.textContent,offset:a.top+a.height/2-b.top-b.height/2}
      }))
      const normal=await measure()
      assert.ok(normal.length>=8)
      assert.ok(normal.every(row=>Math.abs(row.offset)<=0.5),JSON.stringify(normal))
      assert.equal((await page.evaluate(measureControlCentering,'#selection')).findings.length,0)
      await page.getByRole('checkbox',{name:'全選択',exact:true}).check()
      assert.equal(await page.getByRole('checkbox',{name:'行を選ぶ',exact:true}).isChecked(),true)
      const boxes=await page.locator('#selection input[type="checkbox"]').evaluateAll(inputs=>inputs.map(input=>{
        const frame=input.nextElementSibling?.tagName==='SPAN'?input.nextElementSibling:input;
        const style=getComputedStyle(frame),rect=frame.getBoundingClientRect();
        return {width:rect.width,height:rect.height,radius:style.borderRadius,ring:style.outlineWidth,image:style.backgroundImage};
      }))
      assert.ok(boxes.every(box=>box.width===16&&box.height===16&&box.radius==='4px'&&box.ring==='1px'&&box.image==='none'),JSON.stringify(boxes))
      await page.getByRole('checkbox',{name:'ラベル付き',exact:true}).focus(); await page.keyboard.press('Space')
      assert.equal(await page.getByRole('checkbox',{name:'全選択',exact:true}).isChecked(),false)
      // 実寸をずらした場合に、この計測がずれを見逃さないことを確かめる。
      await page.getByRole('checkbox',{name:'全選択',exact:true}).evaluate(el=>el.style.top='-2px')
      assert.ok((await measure()).some(row=>Math.abs(row.offset)>0.5))
      await page.getByRole('checkbox',{name:'全選択',exact:true}).evaluate(el=>el.style.top='')
      assert.ok((await measure()).every(row=>Math.abs(row.offset)<=0.5))
    } finally {await browser.close()}
  })

  test(`8種類の窓で頭と操作が切れず、明るい面と任意の印を保つ ${width}`,async()=>{
    const browser=await connectGuardBrowser()
    try{
      const page=await browser.newPage({reducedMotion:'reduce'})
      await mount(page,width)
      for(const name of ['通常','確認','危険','警告','手順','選択','長文','引き出し']){
        await page.getByRole('button',{name,exact:true}).click()
        const panel=page.locator('[aria-modal="true"]')
        await panel.waitFor()
        // 開いた直後の描画と遷移を終えてから、表示中の窓を測る。
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
        await panel.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)))
        const measure=()=>panel.evaluate(el=>{
          const rect=el.getBoundingClientRect(),style=getComputedStyle(el)
          const heading=el.querySelector('h2').getBoundingClientRect()
          const controls=[...el.querySelectorAll('button')].map(button=>button.getBoundingClientRect())
          const iconEl=el.querySelector('[class*="headerIcon"]'),icon=iconEl.getBoundingClientRect(),close=el.querySelector('button[aria-label="閉じる"]'),closeRect=close.getBoundingClientRect(),closeStyle=getComputedStyle(close)
          return {background:style.backgroundColor,radius:style.borderTopLeftRadius,shadow:style.boxShadow,
            bounds:rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,
            heading:heading.top>=rect.top&&heading.bottom<=rect.bottom,icon:icon.width,iconRadius:getComputedStyle(iconEl).borderRadius,
            closeRound:parseFloat(closeStyle.borderRadius)>=Math.min(closeRect.width,closeRect.height)/2,
            controls:controls.every(b=>b.left>=rect.left&&b.right<=rect.right&&b.top>=rect.top&&b.bottom<=rect.bottom)}
        })
        let geometry
        await expect.poll(async()=>{geometry=await measure();return geometry.radius},{message:`${name}: 窓の角丸`}).toBe('16px')
        assert.equal(geometry.bounds,true,`${name}: ${JSON.stringify(geometry)}`)
        assert.equal(geometry.heading,true,name);assert.equal(geometry.controls,true,name)
        assert.equal(geometry.radius,'16px',`${name}: ${JSON.stringify(geometry)}`);assert.equal(geometry.icon,32)
        assert.ok(parseFloat(geometry.iconRadius)>=16);assert.equal(geometry.closeRound,true)
        assert.equal(geometry.background,'rgb(255, 255, 255)');assert.notEqual(geometry.shadow,'none')
        if(name!=='引き出し'){
          const cancel=panel.getByRole('button',{name:'キャンセル',exact:true});
          await page.keyboard.press('Tab');await cancel.focus();
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          await cancel.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)))
          const focus=await cancel.evaluate(el=>({width:getComputedStyle(el).outlineWidth,color:getComputedStyle(el).outlineColor}));
          assert.equal(focus.width,'2px');assert.equal(focus.color,'rgb(37, 99, 235)',name);
        }
        await panel.getByRole('button',{name:'閉じる',exact:true}).click()
        await panel.waitFor({state:'detached'})
      }
    }finally{await browser.close()}
  })
}

for (const width of [1152,1440]) {
  test(`知らせの［×］を操作のボタンと縦の真ん中でそろえる（題が1行でも2行でも） ${width}`,async()=>{
    const browser=await connectGuardBrowser()
    try{
      const page=await browser.newPage({reducedMotion:'reduce'})
      await mount(page,width)
      const measure=()=>page.locator('#notices').evaluate(root=>[...root.querySelectorAll('[data-design-part="notice"]')].map(notice=>{
        const close=notice.querySelector('button[aria-label="通知を閉じる"]')
        const actions=[...notice.querySelectorAll('[class*="action"] [data-shared-button]')]
        const center=el=>{const r=el.getBoundingClientRect();return r.top+r.height/2}
        const heading=notice.querySelector('[class*="heading"]')
        return {lines:heading?Math.round(heading.getBoundingClientRect().height/parseFloat(getComputedStyle(heading).lineHeight)):0,
          offsets:actions.map(button=>center(close)-center(button))}
      }))
      const rows=await measure()
      assert.equal(rows.length,4)
      assert.ok(rows.some(row=>row.lines>=2),JSON.stringify(rows))
      assert.ok(rows.every(row=>row.offsets.length>0&&row.offsets.every(offset=>Math.abs(offset)<=0.5)),JSON.stringify(rows))
      // ［×］を2pxずらすと、この計測が見逃さないことを確かめる。
      await page.locator('#notices button[aria-label="通知を閉じる"]').first().evaluate(el=>{el.style.position='relative';el.style.top='-2px'})
      assert.ok((await measure()).some(row=>row.offsets.some(offset=>Math.abs(offset)>0.5)))
    }finally{await browser.close()}
  })
}

for (const stripWidth of [852,1140]) {
  test(`数のカードは札があっても題と補足を切らず、札は題・数字と重ならない（帯の幅 ${stripWidth}）`,async()=>{
    const browser=await connectGuardBrowser()
    try{
      const page=await browser.newPage({reducedMotion:'reduce'})
      await mount(page,1440)
      const measure=()=>page.locator(`[data-kpi-fixture="${stripWidth}"]`).evaluate(root=>[...root.querySelectorAll('[data-kpi-strip] > [data-design-version]')].map(card=>{
        const box=el=>el?.getBoundingClientRect()
        // 「…」で省略している（text-overflow: ellipsis で中身が入り切らない）要素があれば切れている。
        const cut=el=>!!el&&[el,...el.querySelectorAll('*')].some(node=>getComputedStyle(node).textOverflow==='ellipsis'&&node.scrollWidth>node.clientWidth+1)
        const text=card.querySelector('[data-kpi-label] [data-help-trigger] > span')??card.querySelector('[data-kpi-label]')
        const badge=box(card.querySelector('[data-kpi-badge]')),label=box(text),number=box(card.querySelector('[data-kpi-value]'))
        const hit=(a,b)=>!!a&&!!b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top
        const note=card.querySelector('[data-kpi-detail] > span:first-child')
        return {labelCut:cut(card.querySelector('[data-kpi-label]'))||(!!label&&box(card).right<label.right),noteCut:cut(note),
          overlap:hit(badge,label)||hit(badge,number),inside:!badge||badge.right<=box(card).right,
          link:card.querySelector('[data-kpi-detail] a')?getComputedStyle(card.querySelector('[data-kpi-detail] a')).color:null}
      }))
      const rows=await measure()
      assert.equal(rows.length,4)
      assert.ok(rows.every(row=>!row.labelCut&&!row.noteCut&&!row.overlap&&row.inside),JSON.stringify(rows))
      // 行き先「〇〇へ →」は文字のリンクの決まり（緑）。
      assert.ok(rows.filter(row=>row.link).length===3&&rows.every(row=>!row.link||row.link==='rgb(8, 122, 62)'),JSON.stringify(rows))
      // 札を題の上へ重ねると、この計測が見逃さないことを確かめる。
      await page.locator(`[data-kpi-fixture="${stripWidth}"] [data-kpi-badge]`).first().evaluate(el=>{const label=el.closest('[data-design-version]').querySelector('[data-kpi-label]').getBoundingClientRect();Object.assign(el.style,{position:'fixed',left:`${label.left}px`,top:`${label.top}px`})})
      assert.ok((await measure()).some(row=>row.overlap))
    }finally{await browser.close()}
  })
}

test('窓の角丸が欠けたままなら描画待ちでも失敗し、復元後に通る',async()=>{
  const browser=await connectGuardBrowser()
  try{
    const page=await browser.newPage({reducedMotion:'reduce'})
    await mount(page,1152)
    await page.getByRole('button',{name:'通常',exact:true}).click()
    const panel=page.getByRole('dialog',{name:'新しく作る'})
    const radius=()=>panel.evaluate(el=>getComputedStyle(el).borderTopLeftRadius)
    await expect.poll(radius).toBe('16px')
    const fault=await page.addStyleTag({content:'[aria-modal="true"]{border-top-left-radius:0px!important}'})
    await expect.poll(radius).toBe('0px')
    await assert.rejects(expect.poll(radius,{timeout:300}).toBe('16px'))
    await fault.evaluate(el=>el.remove())
    await expect.poll(radius).toBe('16px')
  }finally{await browser.close()}
})

for(const reducedMotion of ['reduce','no-preference']) {
  test(`窓と探す窓は動きを減らす設定を守り、閉じかけでも開き直せる ${reducedMotion}`,async()=>{
    const browser=await connectGuardBrowser()
    try {
      const page=await browser.newPage({reducedMotion})
      await mount(page,1440)
      await page.getByRole('button',{name:'通常',exact:true}).click()
      const panel=page.getByRole('dialog',{name:'新しく作る'})
      const motion=await panel.evaluate(el=>({duration:getComputedStyle(el).transitionDuration,properties:getComputedStyle(el).transitionProperty,blur:getComputedStyle(el.parentElement).backdropFilter}))
      assert.equal(motion.blur,'blur(4px)')
      if(reducedMotion==='no-preference') { assert.equal(motion.duration,'0.2s, 0.2s'); assert.equal(motion.properties,'opacity, transform') }
      else assert.ok(motion.duration.split(',').every(value=>parseFloat(value)<0.001))
      await panel.getByRole('button',{name:'閉じる',exact:true}).click()
      await page.getByRole('button',{name:'通常',exact:true}).click()
      await panel.waitFor()
      assert.equal(await panel.getByLabel('名前',{exact:true}).inputValue(),'保持する名前')
      await panel.getByRole('button',{name:'閉じる',exact:true}).click()
      await panel.waitFor({state:'detached'})
      await page.keyboard.press('Control+k')
      const palette=page.getByRole('dialog',{name:'機能と友だちを探す'})
      await palette.waitFor()
      assert.equal(await palette.evaluate(el=>getComputedStyle(el).borderRadius),'16px')
      await page.getByRole('textbox',{name:'機能と友だちを探す',exact:true}).fill('友だち')
      assert.equal(await page.getByRole('option',{name:'友だち一覧'}).count(),1)
      await page.keyboard.press('Escape'); await page.keyboard.press('Control+k')
      await palette.waitFor()
      await page.keyboard.press('Escape'); await palette.waitFor({state:'detached'})
    } finally {await browser.close()}
  })
}
