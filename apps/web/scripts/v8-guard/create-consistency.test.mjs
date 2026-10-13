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

test('Y2 実物の作成型CSSで右欄は白い板と同じ地、灰色へ戻す故障を落としplainも保つ',async()=>{
 const css=readFileSync(new URL('../../src/components/templates/page-templates.module.css',import.meta.url),'utf8').replace(/:global\(([^()]*)\)/g,'$1');
 const content=`<style>${globals}${css}</style><div data-theme="v8"><main style="width:900px"><section class="frame" data-standalone data-page-template="create"><aside class="preview" data-template-region="preview"><div class="previewContent">設定のカード</div></aside></section></main></div>`;
 const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent(content);assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y2,0);
 await page.addStyleTag({content:'[data-page-template="create"] .preview{background:#f7f8fa!important}'});assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y2,1);
 await page.setContent(content.replace('class="preview"','class="otherRail"')+'<style>.otherRail{width:380px;padding:24px;background:#f7f8fa}</style>');assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y2,0);
 await page.setContent(content);await page.locator('.preview').evaluate(e=>e.setAttribute('data-preview-surface','plain'));assert.equal(await page.locator('.preview').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
 }finally{await browser.close()}
});

test('Y3 作る題と編集のパンくずの不一致を落とし、同じ状態の題なら通す',async()=>{
 const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent('<nav aria-label="パンくず"><h1>ルールを編集・基本設定</h1></nav><main><section data-page-template="create"><h2>ルールを作る</h2></section></main>');assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y3,1);
 await page.locator('nav h1').evaluate(e=>e.textContent='ルールを作る・基本設定');assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y3,0);
 await page.locator('main h2').evaluate(e=>e.textContent='ルールを編集');await page.locator('nav h1').evaluate(e=>e.textContent='ルールを編集・基本設定');assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y3,0);
 }finally{await browser.close()}
});

test('Y4 主保存の実SVGを数え、チェック・印なし・二重印の故障を落とす',async()=>{
 const browser=await chromium.launch();try{const page=await browser.newPage();
 const button=icons=>`<main><div data-sticky-actions><button class="button_primary_x">${icons}保存する</button></div></main>`;
 const svg=kind=>`<svg class="lucide lucide-${kind}" width="16" height="16"><path d="M0 0L16 16" /></svg>`;
 for(const icons of [svg('check'),'',svg('save')+svg('check')]){await page.setContent(button(icons));assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y4,1);}
 await page.setContent(button(svg('save')));assert.equal((await page.evaluate(scanCreateConsistency)).counts.Y4,0);
 await page.locator('button').evaluate(e=>{e.textContent='保存中…';e.setAttribute('aria-busy','true')});assert.equal((await page.evaluate(scanCreateConsistency)).saves.length,0);
 await page.setContent(button(svg('arrow-right')).replace('保存する','次へ'));assert.equal((await page.evaluate(scanCreateConsistency)).saves.length,0);
 }finally{await browser.close()}
});
