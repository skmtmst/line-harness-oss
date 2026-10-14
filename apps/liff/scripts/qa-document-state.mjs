import assert from 'node:assert/strict';

const testImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

export async function uploadQaDocument(page) {
  for (const side of ['front', 'back']) {
    const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/forms/qa-document/files');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '写真を選ぶ', exact: true }).click();
    await (await chooser).setFiles({ name: `qa-${side}.png`, mimeType: 'image/png', buffer: testImage });
    const result = await response;
    assert.ok(result.ok(), 'ローカルの試験用アップロードが成功する');
    assert.equal((await result.json()).data.file.side, side);
    await page.getByRole('button', { name: `qa-${side}.pngを外す`, exact: true }).waitFor();
  }
  assert.equal(await page.getByAltText('送った写真').count(), 2);
}
