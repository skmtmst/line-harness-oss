import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { signPrivateImageUrl } from '../services/image-access.js';

vi.mock('../middleware/role-guard.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/role-guard.js')>()),
}));

const { images } = await import('./images.js');

const get = vi.fn();
const webinarSource = vi.fn(async () => null as unknown);

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { API_KEY: 'synthetic-signing-key', IMAGES: { get }, DB: { prepare: () => ({ bind: () => ({ first: webinarSource }) }) } } as unknown as Env['Bindings'];
    return next();
  });
  instance.route('/', images);
  return instance;
}

describe('公開画像配信の安全ヘッダ', () => {
  it('画像は nosniff を付け、そのまま表示する', async () => {
    get.mockResolvedValueOnce({
      body: 'PNGDATA',
      etag: 'etag-1',
      httpMetadata: { contentType: 'image/png' },
    });
    const res = await app().request('/images/abc.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Disposition')).toContain('inline');
  });

  it('公開対象にない書類は読ませない', async () => {
    get.mockResolvedValueOnce({
      body: 'PDFDATA',
      etag: 'etag-2',
      httpMetadata: { contentType: 'application/pdf' },
    });
    const res = await app().request('/images/media/doc.pdf');
    expect(res.status).toBe(404);
  });
});

it('来店スタンプの紙写真は公開画像口から読めず、R2にも触れない',async()=>{
 get.mockClear();const res=await app().request('/images/private/visit-stamps/shop/friend/paper');expect(res.status).toBe(404);expect(get).not.toHaveBeenCalled();
});


it.each(['delivery.jpg', 'rich-menus/account/group/page/image.png', 'banner/b/image.jpg', 'imagemaps/asset/1040', 'hq-templates/tenant/uploads/image.png'])('S11 keeps existing published image location %s visible', async key => {
 get.mockReset(); get.mockResolvedValue({ body: 'synthetic-image', etag: 'test', httpMetadata: { contentType: 'image/png' } });
 const res=await app().request(`/images/${key}`); expect(res.status).toBe(200); expect(get).toHaveBeenCalledWith(key);
});
it.each(['nen-pets/friend/pet.jpg','nen-pet-profiles/friend/pet.jpg','nen-photo-review/friend/photo.jpg','form-uploads/form/friend/photo.jpg','webinars/video/segment.ts','unknown/data.json','broadcast-upload/pending.mp4','banner/job/1/source'])('S11 blocks private or unpublished location %s before reading content', async key => {
 get.mockReset(); get.mockResolvedValue({ body: 'synthetic-private', etag: 'test', httpMetadata: { contentType: 'image/jpeg' } });
 expect((await app().request(`/images/${key}`)).status).toBe(404); expect(get).not.toHaveBeenCalled();
});

it('S11 serves a signed private image without caching and refuses a changed signature', async () => {
 get.mockReset(); get.mockResolvedValue({ body: 'synthetic-image', etag: 'test', httpMetadata: { contentType: 'image/jpeg' } });
 const signed = await signPrivateImageUrl(new URL('http://localhost/images/form-uploads/form/friend/photo.jpg'), 'synthetic-signing-key');
 const response = await app().request(signed);
 expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
 get.mockClear();
 expect((await app().request(signed.replace('photo.jpg', 'other.jpg'))).status).toBe(404);
 expect(get).not.toHaveBeenCalled();
});
it('S11 refuses webinar originals even under a published media location', async () => {
 webinarSource.mockResolvedValueOnce({ id: 'synthetic-webinar' }); get.mockClear();
 expect((await app().request('/images/media/webinar/frame.jpg')).status).toBe(404);
 expect(get).not.toHaveBeenCalled();
});

it.each(['"etag-conditional"','W/"etag-conditional"','"other", "etag-conditional"','*'])('public conditional request %s returns 304 without a body',async tag=>{
 get.mockReset();get.mockResolvedValue({body:'synthetic-image',etag:'etag-conditional',httpEtag:'"etag-conditional"',httpMetadata:{contentType:'image/png'}});
 const response=await app().request('/images/conditional.png',{headers:{'If-None-Match':tag}});
 expect(response.status).toBe(304);expect(await response.text()).toBe('');
 expect(response.headers.get('ETag')).toBe('"etag-conditional"');
});
it('nonmatching validators retain the image and return a quoted ETag',async()=>{
 get.mockReset();get.mockResolvedValue({body:'synthetic-image',etag:'etag-current',httpMetadata:{contentType:'image/png'}});
 const response=await app().request('/images/conditional.png',{headers:{'If-None-Match':'"other"'}});
 expect(response.status).toBe(200);expect(await response.text()).toBe('synthetic-image');expect(response.headers.get('ETag')).toBe('"etag-current"');
});
it('private delivery rechecks signatures and retains no-store even with a matching validator',async()=>{
 get.mockReset();get.mockResolvedValue({body:'private-image',etag:'etag-private',httpMetadata:{contentType:'image/png'}});
 const url=await signPrivateImageUrl(new URL('http://localhost/images/form-uploads/form/friend/photo.jpg'),'synthetic-signing-key');
 const response=await app().request(url,{headers:{'If-None-Match':'*'}});
 expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
 get.mockClear();expect((await app().request(url.replace('photo.jpg','other.jpg'),{headers:{'If-None-Match':'*'}})).status).toBe(404);expect(get).not.toHaveBeenCalled();
});

it('requires a published media record even for an existing R2 object and a cache validator', async () => {
 get.mockReset(); get.mockResolvedValue({ body: 'synthetic-image', etag: 'test', httpMetadata: { contentType: 'image/png' } });
 expect((await app().request('/images/media/account/unpublished.png', { headers: { 'If-None-Match': '*' } })).status).toBe(404);
 expect(get).not.toHaveBeenCalled();
});
