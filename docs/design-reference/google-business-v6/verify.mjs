import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const data = scripts.find((match) => match[1].includes('application/json'));
const screens = JSON.parse(data[2]);
assert.equal(screens.length, 19);
assert.equal(new Set(screens.map((screen) => screen.id)).size, 19);
assert.equal(new Set(screens.map((screen) => screen.code)).size, 16);
for (const screen of screens) {
  const png = readFileSync(new URL(`./${screen.id}.png`, import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), screen.width);
  assert.equal(png.readUInt32BE(20), screen.height);
  for (const area of screen.areas) {
    const label = `${screen.id}: ${area.label}`;
    assert.ok(area.label && area.x >= 0 && area.y >= 0, label);
    assert.ok(area.width > 0 && area.height > 0, label);
    assert.ok(area.x + area.width <= screen.width + 1, label);
    assert.ok(area.y + area.height <= screen.height + 1, label);
  }
}
for (const script of scripts.filter((match) => !match[1].includes('application/json'))) {
  new Script(script[2]);
  for (const match of script[2].matchAll(/'GB-\d+'/g)) {
    assert.ok(screens.some((screen) => screen.code === match[0].slice(1, -1)));
  }
}
assert.ok(html.includes("connect-src 'none'"));
assert.ok(html.includes("form-action 'none'"));
assert.ok(!/fetch\s*\(|XMLHttpRequest|WebSocket/.test(html));
console.log('PASS: 19 screens, 16 flows, PNG dimensions, hotspot bounds, target screens, JS syntax, no outbound APIs');
