import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
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
import CommandPalette from './src/components/shared/command-palette';
function Fixture(){
 const [window,setWindow]=useState(''),[value,setValue]=useState(false),[current,setCurrent]=useState('now');
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
  <section id="windows">{['通常','確認','危険','警告','手順','選択','長文','引き出し'].map(name=><Button key={name} onClick={()=>setWindow(name)}>{name}</Button>)}</section>
  {window==='引き出し'?<Drawer open title="設定を編集する" headerIcon={props.headerIcon} description={props.description} onClose={()=>setWindow('')} footer={<Button onClick={()=>setWindow('')}>保存する</Button>}><input aria-label="名前" defaultValue="保持する名前"/></Drawer>:
   ['確認','危険','警告'].includes(window)?<ConfirmDialog {...props} title="内容を確認しますか？" destructive={window==='危険'} warning={window==='警告'}/>:
   <Dialog {...props} open={!!window} widthPreset={window==='選択'?'picker':undefined} steps={window==='手順'?<Steps label="窓の手順" steps={steps} currentKey="now"/>:null}>
    <label>名前<input aria-label="名前" defaultValue="保持する名前"/></label>{window==='長文'?<div style={{height:1600}}>長い内容</div>:null}
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
const globals = await compileUiStyles(new URL('../../src/app/globals.css', import.meta.url).pathname)
const css = [globals, ...sheets].join('\n').replace(/:global\(([^()]*)\)/g, '$1')

async function mount(page, width) {
  await page.setViewportSize({ width, height: 900 })
  await page.setContent(`<html data-theme="v8"><style>${css}*{box-sizing:border-box}body{margin:0}main{margin:24px 24px 24px 264px}#selection{margin-top:24px}#windows{display:flex;gap:8px}[data-center-row]{height:40px;display:flex;align-items:center}#selection>label{margin-block:12px}</style><div id="root"></div></html>`)
  await page.addScriptTag({ content: compiled.outputFiles[0].text })
  await page.getByRole('button', { name: '通常', exact: true }).waitFor()
}

for (const width of [1152,1440,1920]) {
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
        const geometry=await panel.evaluate(el=>{
          const rect=el.getBoundingClientRect(),style=getComputedStyle(el)
          const heading=el.querySelector('h2').getBoundingClientRect()
          const controls=[...el.querySelectorAll('button')].map(button=>button.getBoundingClientRect())
          const icon=el.querySelector('[class*="headerIcon"]').getBoundingClientRect()
          return {background:style.backgroundColor,radius:style.borderTopLeftRadius,shadow:style.boxShadow,
            bounds:rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,
            heading:heading.top>=rect.top&&heading.bottom<=rect.bottom,icon:icon.width,
            controls:controls.every(b=>b.left>=rect.left&&b.right<=rect.right&&b.top>=rect.top&&b.bottom<=rect.bottom)}
        })
        assert.equal(geometry.bounds,true,`${name}: ${JSON.stringify(geometry)}`)
        assert.equal(geometry.heading,true,name);assert.equal(geometry.controls,true,name)
        assert.equal(geometry.radius,'16px');assert.equal(geometry.icon,32)
        assert.equal(geometry.background,'rgb(255, 255, 255)');assert.notEqual(geometry.shadow,'none')
        await panel.getByRole('button',{name:'閉じる',exact:true}).click()
        await panel.waitFor({state:'detached'})
      }
    }finally{await browser.close()}
  })
}

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
