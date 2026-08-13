import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const INDEX_URL = 'https://www.pfirst.jp/contents_counselling_top.html';
const OUTPUT = resolve(process.cwd(), 'data/nen-knowledge-pfirst.json');
const concurrency = 8;

function decode(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function plain(html) {
  return decode(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<figure[\s\S]*?<\/figure>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/h\d>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

function inferAnimal(text) {
  const dog = (text.match(/犬|ワンちゃん|愛犬|子犬|ドッグ/g) || []).length;
  const cat = (text.match(/猫|ネコちゃん|愛猫|子猫|キャット/g) || []).length;
  return dog === cat ? 'all' : dog > cat ? 'dog' : 'cat';
}

function inferTags(text) {
  const groups = {
    食事: /ご飯|フード|食欲|食いつき|偏食|おやつ|栄養|サプリ|水を|飲み水/,
    排泄: /便|うんち|ウンチ|下痢|軟便|便秘|おしっこ|オシッコ|トイレ|排泄/,
    皮膚被毛: /皮膚|毛|被毛|脱毛|ブラッシング|シャンプー|かゆ|痒|アレルギー/,
    目: /目|涙|目やに|まつげ/,
    耳: /耳|イヤー/,
    口歯: /口|歯|デンタル|ひげ|ヒゲ/,
    呼吸: /咳|呼吸|しゃっくり|くしゃみ|いびき/,
    行動しつけ: /しつけ|噛|吠|鳴|威嚇|遊|留守番|ストレス|散歩|トレーニング|嫉妬|多頭飼い/,
    生活環境: /ケージ|クレート|サークル|旅行|電車|タクシー|ホテル|寝|ベッド|室内/,
    予防医療: /ワクチン|感染症|薬|病院|疾患|発情|ヒート/,
  };
  return Object.entries(groups).filter(([, re]) => re.test(text)).map(([tag]) => tag);
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'NEN-Knowledge-Sync/1.0 (+https://nen-petfood.com)' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function article(url) {
  const html = await fetchText(url);
  const title = plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').replace(/^【ペットのお悩み相談室】/, '');
  const bodyHtml = html.match(/<div class="blog-body">([\s\S]*?)<div class="blog-footer">/i)?.[1]
    || html.match(/<div class="blog-body">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="blog-footer">/i)?.[1]
    || '';
  const body = plain(bodyHtml).replace(/子犬・子猫一覧\s*$/u, '').trim();
  if (!title || body.length < 60) throw new Error(`本文を抽出できません: ${url}`);
  const number = Number(url.match(/counselling(\d+)\.html/)?.[1] || 0);
  return { id: `pfirst-${number}`, source: 'Pets-first ペットのお悩み相談室', sourceUrl: url, title, animalType: inferAnimal(`${title}\n${body}`), tags: inferTags(`${title}\n${body}`), body };
}

const index = await fetchText(INDEX_URL);
const urls = [...new Set([...index.matchAll(/href="(?:https:\/\/www\.pfirst\.jp\/)?(contents_counselling\d+\.html)"/g)].map(([, path]) => `https://www.pfirst.jp/${path}`))]
  .sort((a, b) => Number(a.match(/(\d+)\.html/)?.[1]) - Number(b.match(/(\d+)\.html/)?.[1]));

if (!urls.length) throw new Error('記事URLが見つかりませんでした');
const rows = new Array(urls.length);
let cursor = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < urls.length) {
    const index = cursor++;
    rows[index] = await article(urls[index]);
    process.stdout.write(`\r${rows.filter(Boolean).length}/${urls.length}`);
  }
}));

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify({ sourceUrl: INDEX_URL, fetchedAt: new Date().toISOString(), count: rows.length, articles: rows }, null, 2)}\n`, 'utf8');
process.stdout.write(`\nSaved ${rows.length} articles to ${OUTPUT}\n`);
