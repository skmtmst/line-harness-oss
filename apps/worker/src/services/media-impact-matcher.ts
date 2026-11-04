/** Aho–Corasick: scan each stored value once, even for a batch of 200 keys. */
export class MediaImpactMatcher {
  private nodes: Array<{next:Map<string,number>;fail:number;out:number[]}> = [{next:new Map(),fail:0,out:[]}];
  private exact = new Map<string,number[]>();

  constructor(items: Array<{key:string;mediaId:string;includeLive:boolean}>) {
    items.forEach((item,index) => {
      this.add(item.key,index);
      if (item.includeLive) {
        this.add(`/media/${item.mediaId}/content`,index);
        this.exact.set(item.mediaId,[...(this.exact.get(item.mediaId) ?? []),index]);
      }
    });
    const queue:number[]=[];
    for (const child of this.nodes[0].next.values()) queue.push(child);
    for (let i=0;i<queue.length;i++) {
      const node=queue[i];
      for (const [char,child] of this.nodes[node].next) {
        queue.push(child); let fallback=this.nodes[node].fail;
        while (fallback && !this.nodes[fallback].next.has(char)) fallback=this.nodes[fallback].fail;
        this.nodes[child].fail=this.nodes[fallback].next.get(char) ?? 0;
        this.nodes[child].out.push(...this.nodes[this.nodes[child].fail].out);
      }
    }
  }

  private add(pattern:string,index:number):void {
    if (!pattern) return;
    let node=0;
    for (const char of pattern) {
      let child=this.nodes[node].next.get(char);
      if (child===undefined) { child=this.nodes.length; this.nodes.push({next:new Map(),fail:0,out:[]}); this.nodes[node].next.set(char,child); }
      node=child;
    }
    this.nodes[node].out.push(index);
  }

  /** JSON can be nested or stored as a JSON string inside another JSON value. */
  match(input:unknown):Set<number> {
    const result=new Set<number>();
    const visit=(value:unknown,depth:number):void => {
      if (depth>32) throw new Error('media_reference_too_nested');
      if (Array.isArray(value)) { for (const item of value) visit(item,depth+1); return; }
      if (value && typeof value==='object') { for (const item of Object.values(value)) visit(item,depth+1); return; }
      if (typeof value!=='string') return;
      for (const index of this.exact.get(value) ?? []) result.add(index);
      const scan=(text:string) => {
        let node=0;
        for (const char of text) {
          while (node && !this.nodes[node].next.has(char)) node=this.nodes[node].fail;
          node=this.nodes[node].next.get(char) ?? 0;
          for (const index of this.nodes[node].out) result.add(index);
        }
      };
      scan(value);
      try { const decoded=decodeURIComponent(value); if (decoded!==value) scan(decoded); } catch { /* retain the original string */ }
      try { const parsed:unknown=JSON.parse(value); if (parsed!==value) visit(parsed,depth+1); } catch (error) {
        if (error instanceof SyntaxError) return;
        throw error;
      }
    };
    visit(input,0); return result;
  }
}
