export function scanShapes(){
 const findings=[],inventory=[]
 const visible=el=>{if(!el||el.closest('[hidden],[inert]'))return false;for(let p=el;p;p=p.parentElement){const c=getComputedStyle(p);if(c.display==='none'||c.visibility!=='visible'||Number(c.opacity)===0)return false}const r=el.getBoundingClientRect();return r.width>1&&r.height>1}
 const root=document.querySelector('[data-m1-scope]')
 const overlays=root&&root.matches('[role="dialog"],[role="alertdialog"],[role="menu"],[data-customer-info-panel]')?[root]:[]
 const frames=[...document.querySelectorAll('[data-page-template]')].filter(visible)
 const add=(el,reason,measure)=>findings.push({pattern:'F10',reason,text:el.textContent.trim().slice(0,80),measure,detector:'M1 shape inventory'})
 for(const el of overlays){const r=el.getBoundingClientRect();inventory.push({type:el.getAttribute('data-design-part')??el.getAttribute('role')??'customer-panel',width:r.width,height:r.height,x:r.x,right:r.right});if(r.width>innerWidth-32||r.x<0||r.right>innerWidth)add(el,'浮く面が画面の内側に収まらない',{width:r.width,x:r.x,right:r.right,viewport:innerWidth})}
 for(const frame of frames){const fr=frame.getBoundingClientRect();inventory.push({type:frame.dataset.pageTemplate,width:fr.width,height:fr.height});
  if(fr.width<1100&&frame.dataset.pageTemplate==='detail'){
   const aside=[...frame.querySelectorAll('aside,[data-template-region="aside"]')].filter(visible),content=frame.querySelector('[data-template-region="content"]');
   if(content)for(const el of aside){const a=el.getBoundingClientRect(),c=content.getBoundingClientRect();if(a.left>=c.right-1&&a.top<c.bottom&&c.top<a.bottom)add(el,'狭い詳細で情報の欄が本文の右に残る',{x:a.x,y:a.y,width:a.width,contentRight:c.right})}
  }
  for(const band of [...frame.querySelectorAll('[data-kpi-strip]')].filter(visible)){
   const cards=[...band.children].filter(visible),br=band.getBoundingClientRect(),rects=cards.map(el=>el.getBoundingClientRect());
   inventory.push({type:'kpi',width:br.width,cards:rects.map(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))});
   if(rects.length===4&&br.width>=720){if(rects.some(r=>Math.abs(r.top-rects[0].top)>1))add(band,'720px以上の数の帯が4マス1段にならない',{width:br.width,rows:new Set(rects.map(r=>Math.round(r.top))).size});for(let i=0;i<rects.length;i++)if(rects[i].width<180-1)add(cards[i],'数のマスが最小180pxより狭い',{width:rects[i].width,band:br.width})}
  }
 }
 return {findings,inventory,covered:overlays.length>0||frames.length>0}
}
