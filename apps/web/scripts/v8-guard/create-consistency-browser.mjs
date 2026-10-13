export default function scanYRules() {
 const visible=e=>{
  if(!e)return false;
  for(let p=e;p;p=p.parentElement){const css=getComputedStyle(p);if(css.display==='none'||css.visibility!=='visible'||p.hidden||p.hasAttribute('inert'))return false;}
  return e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
 };
 const rows=[];const findings=[];
 const selector=el=>{const parts=[];for(let p=el;p&&p!==document.body;p=p.parentElement){if(p.id){parts.unshift('#'+CSS.escape(p.id));break;}let part=p.tagName.toLowerCase();if(p.parentElement){const same=[...p.parentElement.children].filter(c=>c.tagName===p.tagName);if(same.length>1)part+=':nth-of-type('+(same.indexOf(p)+1)+')';}parts.unshift(part);}return parts.join(' > ');};
 const add=(kind,el,detail,measure)=>findings.push({kind,target:selector(el),text:el.textContent.trim(),detail,measure});
 for(const row of document.querySelectorAll('[data-action-row]')){
  if(!visible(row))continue;
  const title=row.querySelector('[data-action-name],[class*="action-list_title"]'),value=row.querySelector('[data-action-value],[class*="action-list_extra"]');
  if(!title||!value||!visible(value))continue;
  const range=document.createRange();range.selectNodeContents(title);
  const gap=value.getBoundingClientRect().left-range.getBoundingClientRect().right;
  const nameSize=getComputedStyle(title).fontSize,valueSize=getComputedStyle(value).fontSize;
  const expected=parseFloat(getComputedStyle(row).getPropertyValue('--tpl-action-row-gap'));
  rows.push({title:title.textContent,value:value.textContent,nameSize,valueSize,gap,expected});
  if(nameSize!==valueSize||gap>expected+1)add('Y1',row,{nameSize,valueSize,gap,expected},{sizeMismatch:Number(nameSize!==valueSize),sizeDifference:Math.abs(parseFloat(nameSize)-parseFloat(valueSize)),gapExcess:Number.isFinite(expected)?Math.max(0,gap-expected):0});
 }
 const previews=[];
 for(const preview of document.querySelectorAll('[data-page-template="create"] [data-template-region="preview"]')){
  if(!visible(preview))continue;
  const bg=getComputedStyle(preview).backgroundColor,canvas=getComputedStyle(preview.closest('[data-page-template]')).backgroundColor;
  previews.push({bg,canvas});if(bg!=='rgba(0, 0, 0, 0)'&&bg!==canvas)add('Y2',preview,{bg,canvas},{surfaceMismatch:1});
 }
 const heading=document.querySelector('main [data-page-title],main h1,main h2');
 const crumb=document.querySelector('nav[aria-label="パンくず"] h1');
 const title=heading?.textContent.trim()??'',breadcrumb=crumb?.textContent.trim()??document.title.split(' | ')[0];
 if(/作る/.test(title)&&/編集|直す/.test(breadcrumb))add('Y3',heading,{title,breadcrumb},{titleMismatch:1});
 const saves=[];
 for(const button of document.querySelectorAll('[data-sticky-actions] button')){
  if(!visible(button)||!/(保存|登録|作る|つくって|動かす|変更|公開|発行|有効|追加|やり直す)/.test(button.textContent)||button.getAttribute('aria-busy')==='true')continue;
  if(![...button.classList].some(c=>c.includes('_primary')))continue;
  const icons=[...button.querySelectorAll('svg')].map(e=>({classes:e.getAttribute('class'),canonical:e.hasAttribute('data-sticky-save-icon')}));
  saves.push({text:button.textContent,icons});
  if(icons.length!==1||!icons[0].classes?.split(' ').includes('lucide-save'))add('Y4',button,{icons},{iconCountDifference:Math.abs(icons.length-1),wrongIconCount:icons.filter(icon=>!icon.classes?.split(' ').includes('lucide-save')).length});
 }
 return {counts:Object.fromEntries(['Y1','Y2','Y3','Y4'].map(k=>[k,findings.filter(f=>f.kind===k).length])),findings,rows,previews,title,breadcrumb,saves};
}
