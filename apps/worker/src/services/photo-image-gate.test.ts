import Database from 'better-sqlite3';
import { afterEach,beforeEach,expect,it } from 'vitest';
import { photoImageScanAllowed } from './photo-image-gate.js';
let raw:Database.Database;
const id='12345678-1234-4234-8234-123456789012';
const key=`nen-photo-public/f/${id}-v1.jpg`;
let queries:Array<{sql:string;values:unknown[]}>;
let db:D1Database;
beforeEach(()=>{
 raw=new Database(':memory:');queries=[];
 raw.exec(`CREATE TABLE nen_photo_submissions(id TEXT PRIMARY KEY,line_account_id TEXT,review_image_url TEXT,public_image_url TEXT,review_r2_key TEXT,public_r2_key TEXT);
 CREATE TABLE media_file_scans(subject_kind TEXT,subject_id TEXT,line_account_id TEXT,status TEXT);
 CREATE INDEX idx_media_file_scans_subject ON media_file_scans(subject_kind,subject_id);
 CREATE INDEX idx_photo_review ON nen_photo_submissions(review_r2_key);
 CREATE INDEX idx_photo_public ON nen_photo_submissions(public_r2_key);`);
 raw.prepare('INSERT INTO nen_photo_submissions(id,line_account_id,review_image_url,public_image_url) VALUES (?,?,?,?)').run(id,'a',null,`https://worker.test/images/${key}`);
 raw.prepare('INSERT INTO media_file_scans VALUES (?,?,?,?)').run('photo',id,'a','clean');
 db={prepare:(sql:string)=>({bind:(...values:unknown[])=>({first:async()=>{queries.push({sql,values});return raw.prepare(sql).get(...values) ?? null;}})})} as unknown as D1Database;
});
afterEach(()=>raw.close());
it('looks up a current derivative through indexed submission and scan keys',async()=>{
 expect(await photoImageScanAllowed(db,key)).toBe(true);expect(queries).toHaveLength(2);
 const plan=raw.prepare(`EXPLAIN QUERY PLAN ${queries[1].sql}`).all(...queries[1].values) as Array<{detail:string}>;
 expect(plan.map(row=>row.detail).join('\n')).toMatch(/SEARCH ps USING INDEX/);
 expect(plan.map(row=>row.detail).join('\n')).toMatch(/SEARCH scan USING INDEX idx_media_file_scans_subject/);
 expect(plan.map(row=>row.detail).join('\n')).not.toMatch(/SCAN ps/);
});
it.each(['pending','rejected','quarantined'])('retains the safety gate for %s scans',async status=>{
 raw.prepare('UPDATE media_file_scans SET status=?').run(status);expect(await photoImageScanAllowed(db,key)).toBe(false);expect(queries).toHaveLength(2);
});
it('does not accept a clean scan from another account or a different derivative URL',async()=>{
 raw.exec("UPDATE media_file_scans SET line_account_id='b'");expect(await photoImageScanAllowed(db,key)).toBe(false);
 raw.exec("UPDATE media_file_scans SET line_account_id='a';UPDATE nen_photo_submissions SET public_image_url='https://worker.test/images/other.jpg'");
 expect(await photoImageScanAllowed(db,key)).toBe(false);
});
it('keeps the legacy custom URL lookup and its scan requirement',async()=>{
 raw.exec("UPDATE nen_photo_submissions SET public_image_url='https://worker.test/images/nen-photo-public/f/legacy.jpg'");
 expect(await photoImageScanAllowed(db,'nen-photo-public/f/legacy.jpg')).toBe(true);
 raw.exec("DELETE FROM media_file_scans");expect(await photoImageScanAllowed(db,'nen-photo-public/f/legacy.jpg')).toBe(false);
});

it('historical custom filenames use exact indexed keys and still require a same-account clean scan',async()=>{
 raw.exec("UPDATE nen_photo_submissions SET public_r2_key='nen-photo-public/f/legacy.jpg',public_image_url='https://worker.test/images/nen-photo-public/f/legacy.jpg'");
 expect(await photoImageScanAllowed(db,'nen-photo-public/f/legacy.jpg')).toBe(true);expect(queries).toHaveLength(1);
 const plan=raw.prepare(`EXPLAIN QUERY PLAN ${queries[0].sql}`).all(...queries[0].values) as Array<{detail:string}>;
 expect(plan.map(r=>r.detail).join(' ')).not.toMatch(/SCAN ps/);
 raw.exec("UPDATE media_file_scans SET line_account_id='another-account'");
 expect(await photoImageScanAllowed(db,'nen-photo-public/f/legacy.jpg')).toBe(false);
});
