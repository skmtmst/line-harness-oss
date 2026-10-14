export default function scanPreviewLayout() {
  const visible = el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
  const rect = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
  const rails=[], groups=[], findings=[];
  const target = el => {
    const parts=[];
    for(let p=el;p && p!==document.body;p=p.parentElement) {
      const peers=[...p.parentElement.children].filter(n=>n.tagName===p.tagName);
      parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(p)+1)+')');
    }
    return parts.join(' > ');
  };
  const add=(kind,el,measure)=>findings.push({kind,target:target(el),text:el.textContent.trim().slice(0,120),measure});
  for(const rail of document.querySelectorAll('[data-page-template="create"] [data-template-region="preview"]')) {
    const content=rail.firstElementChild;
    if(!content || !visible(rail)) continue;
    const cards=[...content.children].filter(el=>el.dataset.cardVariant==='aside');
    const measurements=cards.map(card=>({title:card.querySelector('h2,h3,h4')?.textContent??'',...rect(card)}));
    const expected=rect(content);
    rails.push({content:expected,cards:measurements});
    measurements.forEach((card,index)=>{const excess=Math.max(Math.abs(card.width-expected.width),Math.abs(card.x-expected.x));if(excess>1)add('preview-card-width',cards[index],{excess});});
  }
  for(const group of document.querySelectorAll('[role="radiogroup"][data-preview="menu"], [role="radiogroup"][data-preview="compact-menu"]')) {
    if(!visible(group))continue;
    const tiles=[...group.querySelectorAll('[data-choice-card]')].filter(visible);
    const inputs=tiles.flatMap(tile=>[...tile.querySelectorAll('input[type="radio"]')]);
    const rows=new Set(tiles.map(tile=>Math.round(tile.getBoundingClientRect().y)));
    const indicators=inputs.filter(input=>{const css=getComputedStyle(input),r=input.getBoundingClientRect();return r.width>1 && r.height>1 && Number(css.opacity)>0;});
    const checks=tiles.filter(tile=>tile.querySelector('[data-choice-check]'));
    const selected=inputs.filter(input=>input.checked && !input.disabled);
    const clipped=tiles.filter(tile=>{const title=tile.querySelector('strong'); return title && title.scrollWidth>title.clientWidth+1;});
    groups.push({preview:group.dataset.preview,tiles:tiles.map(rect),rows:rows.size,visibleRadios:indicators.length,selected:selected.length,checks:checks.length,clippedTitles:clipped.length});
    if(rows.size!==1)add('layout-tile-rows',group,{excess:rows.size-1});
    if(indicators.length)add('layout-tile-radio',group,{count:indicators.length});
    if(checks.length!==selected.length)add('layout-tile-check',group,{count:Math.abs(selected.length-checks.length)});
    if(clipped.length)add('layout-tile-title',group,{count:clipped.length});
  }
  return {rails,groups,findings};
}
