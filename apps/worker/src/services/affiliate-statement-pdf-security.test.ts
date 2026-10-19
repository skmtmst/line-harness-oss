import {expect,it} from 'vitest';
import {simplePdf} from './affiliate-statement-pdf.js';
it('new statements carry an escaped actor/time stamp in the PDF body',()=>{
 const bytes=simplePdf({affiliateCode:'fixture',periodFrom:'2026-01-01',periodTo:'2026-01-31',totalAmount:100,currency:'JPY',exportedBy:'fixture(actor)',exportedAt:'2026-10-17T00:00:00Z'});
 const text=new TextDecoder().decode(bytes);expect(text).toContain('Exported by: fixture\\(actor\\)');expect(text).toContain('Exported at: 2026-10-17T00:00:00Z');expect(text).toContain('startxref');
});
