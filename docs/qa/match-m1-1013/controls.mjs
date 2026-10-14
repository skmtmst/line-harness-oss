export function scanAdditionalControls(){
 const roots=[...document.querySelectorAll('[data-m1-scope]')];if(!roots.length)roots.push(...document.querySelectorAll('[data-page-template]'))
 const visible=el=>{if(!el||el.closest('[inert],[hidden],.sr-only'))return false;for(let p=el;p;p=p.parentElement){const c=getComputedStyle(p);if(c.display==='none'||c.visibility!=='visible'||Number(c.opacity)===0)return false}const r=el.getBoundingClientRect();return r.width>1&&r.height>1}
 const findings=[],inventory=[]
 for(const root of roots)for(const el of root.querySelectorAll('button:disabled,input:disabled,select:disabled,[aria-disabled="true"]')){
  if(!visible(el)||el.closest('[data-template-region="toolbar"]')||el.closest('[role="listbox"]'))continue
  const ids=(el.getAttribute('aria-describedby')??'').split(/\s+/),reason=el.title||ids.some(id=>{const r=document.getElementById(id);return visible(r)&&r.textContent.trim()})
  const busy=el.closest('[aria-busy="true"]')||/読み込|保存中|送信中|処理中|しています/.test(el.textContent)
  inventory.push({text:el.textContent.trim().slice(0,80),label:el.getAttribute('aria-label'),reason:!!reason,busy:!!busy})
  if(!reason&&!busy)findings.push({pattern:'F8',reason:'押せない操作にtitleまたは見える理由の接続がない',text:el.textContent.trim().slice(0,80),label:el.getAttribute('aria-label'),detector:'M1 disabled controls'})
 }
 return{findings,inventory}
}
