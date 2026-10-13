// Count independent fields from actual geometry, regardless of component/class name.
export default function collectFormLayouts() {
 const root=document.querySelector('main')||document.body
 const visible=el=>{for(let p=el;p;p=p.parentElement){const c=getComputedStyle(p);if(c.display==='none'||c.visibility!=='visible'||p.hidden||p.hasAttribute('inert'))return false;if(p.matches('details:not([open])')&&!p.querySelector('summary')?.contains(el))return false}const r=el.getBoundingClientRect();return r.width>0&&r.height>0}
 const controlSelector='input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]),textarea,select,button[aria-haspopup="dialog"],button[aria-haspopup="listbox"],button[role="combobox"]'
 const rows=[]
 const selector=el=>{const parts=[];for(let p=el;p&&p!==root.parentElement;p=p.parentElement){const peers=p.parentElement?[...p.parentElement.children].filter(x=>x.tagName===p.tagName):[p];parts.unshift(`${p.tagName.toLowerCase()}:nth-of-type(${peers.indexOf(p)+1})`)}return parts.join(' > ')}
 for(const parent of root.querySelectorAll('div,fieldset,section')){
  if(!visible(parent)||parent.closest('[data-form-requirement]'))continue
  const css=getComputedStyle(parent)
  if(css.display!=='grid'&&css.display!=='flex')continue
  const children=[...parent.children].filter(visible)
  if(children.length<2)continue
  const fields=children.map(child=>{
   const cs=[...(child.matches(controlSelector)?[child]:[]),...child.querySelectorAll(controlSelector)].filter(visible)
   const marked=[...(child.matches('[data-form-requirement]')?[child]:[]),...child.querySelectorAll('[data-form-requirement]')].filter(visible).filter(el=>{const outer=el.parentElement?.closest('[data-form-requirement]');return !outer||!child.contains(outer)})
   if(!cs.length && !marked.some(el=>[...el.querySelectorAll('[role=radio],[role=checkbox],button[aria-pressed]')].some(visible)))return null
   // Nested forms/cards are regions, not two independent fields.
   if(marked.length>1 || (!marked.length&&cs.length>2))return null
   const label=child.querySelector('label,[id*="label"],[class*="label"]')?.textContent?.trim()||cs[0]?.getAttribute('aria-label')||cs[0]?.getAttribute('placeholder')||cs[0]?.id||cs[0]?.tagName||'入力欄'
