import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import scanCreateConsistency from './create-consistency-browser.mjs'
const globals=readFileSync(new URL('../../src/app/globals.css',import.meta.url),'utf8');
const actions=()=>readFileSync(new URL('../../src/components/shared/action-list.module.css',import.meta.url),'utf8');
const row='<div class="item" data-action-row><div class="row"><span class="icon">◆</span><div class="details"><button class="titleButton" data-action-name>本人にLINEで知らせる</button><div class="extra" data-action-value>成果1件ごとに</div></div><button aria-label="その他操作">…</button></div></div>';
const html=css=>`<style>${globals}${css}</style><div data-theme="v8"><main style="width:650px"><section data-page-template="create">${row}</section></main></div>`;
test('Y1 実物の行CSSで名前と値は同じ文字サイズで隣り合い、広い名前枠へ戻す故障を落とす',async()=>{
 const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent(html(actions()));const good=await page.evaluate(scanCreateConsistency);assert.equal(good.counts.Y1,0,JSON.stringify(good.rows));
 await page.addStyleTag({content:'.titleButton{flex:1}.extra{font-size:16px}'});assert.ok((await page.evaluate(scanCreateConsistency)).counts.Y1>0);
 await page.setContent(html(actions()));assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y1,0);
 }finally{await browser.close()}
});
