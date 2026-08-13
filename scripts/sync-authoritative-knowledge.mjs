import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const OUTPUT = resolve(process.cwd(), 'data/nen-knowledge-authoritative.json');
const UA = 'NEN-Knowledge-Sync/2.0 (+https://nen-petfood.com; source-attributed veterinary RAG)';

const sources = [
  {
    name: 'MSD/Merck Veterinary Manual — Dog Owners',
    kind: 'peer_reviewed_veterinary_manual', rank: 92, language: 'en', animalType: 'dog',
    hubs: ['https://www.merckvetmanual.com/dog-owners'],
    allow: /^https:\/\/www\.merckvetmanual\.com\/dog-owners\/.+/,
  },
  {
    name: 'MSD/Merck Veterinary Manual — Cat Owners',
    kind: 'peer_reviewed_veterinary_manual', rank: 92, language: 'en', animalType: 'cat',
    hubs: ['https://www.merckvetmanual.com/cat-owners'],
    allow: /^https:\/\/www\.merckvetmanual\.com\/cat-owners\/.+/,
  },
  {
    name: 'Cornell University College of Veterinary Medicine — Canine Health Center',
    kind: 'veterinary_university', rank: 96, language: 'en', animalType: 'dog',
    hubs: Array.from({ length: 15 }, (_, page) => `https://www.vet.cornell.edu/departments-centers-and-institutes/riney-canine-health-center/canine-health-topics?page=${page}`),
    allow: /^https:\/\/www\.vet\.cornell\.edu\/departments-centers-and-institutes\/riney-canine-health-center\/(?:canine-health-topics|canine-health-information)\/.+/,
  },
  {
    name: 'Cornell University College of Veterinary Medicine — Feline Health Center',
    kind: 'veterinary_university', rank: 96, language: 'en', animalType: 'cat',
    hubs: [
      'https://www.vet.cornell.edu/departments-centers-and-institutes/cornell-feline-health-center/health-information',
      'https://www.vet.cornell.edu/departments-centers-and-institutes/cornell-feline-health-center/health-information/feline-health-topics',
      'https://www.vet.cornell.edu/departments-centers-and-institutes/cornell-feline-health-center/health-information/feline-infectious-diseases',
    ],
    allow: /^https:\/\/www\.vet\.cornell\.edu\/departments-centers-and-institutes\/cornell-feline-health-center\/health-information\/.+/,
  },
  {
    name: 'U.S. Food and Drug Administration — Animal & Veterinary',
    kind: 'government', rank: 100, language: 'en', animalType: 'all',
    hubs: [
      'https://www.fda.gov/consumers/consumer-updates/animal-veterinary',
      'https://www.fda.gov/animal-veterinary/resources-you/animal-health-literacy',
    ],
    allow: /^https:\/\/www\.fda\.gov\/(?:consumers\/consumer-updates|animal-veterinary\/(?:animal-health-literacy|resources-you))\/.+/,
  },
  {
    name: 'U.S. Centers for Disease Control and Prevention — Healthy Pets',
    kind: 'government', rank: 100, language: 'en', animalType: 'all',
    hubs: [
      'https://www.cdc.gov/healthy-pets/about/dogs.html',
      'https://www.cdc.gov/healthy-pets/about/cats.html',
      'https://www.cdc.gov/healthy-pets/about/index.html',
    ],
    allow: /^https:\/\/www\.cdc\.gov\/healthy-pets\/(?:about|keeping-pets-and-people-healthy)\/.+\.html$/,
  },
  {
    name: '環境省 動物愛護管理室',
    kind: 'government', rank: 100, language: 'ja', animalType: 'all',
    hubs: [
      'https://www.env.go.jp/nature/dobutsu/aigo/2_data/pamph/petfood_guide_1808.html',
      'https://www.env.go.jp/nature/dobutsu/aigo/2_data/pamph/h2202.html',
      'https://www.env.go.jp/nature/dobutsu/aigo/2_data/pamph/kyousei.html',
    ],
    allow: /^https:\/\/www\.env\.go\.jp\/nature\/dobutsu\/aigo\/.+\.html(?:\?.*)?$/,
    includeHubs: true,
  },
  {
    name: '公益社団法人 日本獣医師会',
    kind: 'veterinary_association', rank: 98, language: 'ja', animalType: 'all',
    hubs: [
      'https://jvma-vet.jp/small/medicalcare.html',
      'https://jvma-vet.jp/kurashi/index.html',
    ],
    allow: /^https:\/\/jvma-vet\.jp\/(?:small|kurashi)\/.+\.html$/,
    includeHubs: true,
  },
  {
    name: 'World Small Animal Veterinary Association',
    kind: 'veterinary_association', rank: 98, language: 'en', animalType: 'all',
    hubs: [
      'https://wsava.org/global-guidelines/global-nutrition-guidelines/',
      'https://wsava.org/global-guidelines/animal-welfare-guidelines/',
      'https://wsava.org/global-guidelines/vaccination-guidelines/',
      'https://wsava.org/global-guidelines/dental-guidelines/',
    ],
    allow: /^https:\/\/wsava\.org\/global-guidelines\/.+/,
    includeHubs: true,
  },
];

function decode(value) {
  return value.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function plain(html) {
  return decode(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<nav[\s\S]*?<\/nav>/gi, ' ').replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|h\d|li|section|div)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
}

function canonical(raw, base) {
  try { const url = new URL(decode(raw), base); url.hash = ''; for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_')) url.searchParams.delete(key); return url.href; }
  catch { return ''; }
}

function links(html, base) {
  return [...new Set([...html.matchAll(/href=["']([^"'#]+)["']/gi)].map(([, href]) => canonical(href, base)).filter(Boolean))];
}

function inferTags(text) {
  const groups = {
    食事: /食事|ご飯|フード|食欲|食いつき|栄養|肥満|体重|diet|food|nutrition|obesity|weight|appetite/i,
    排泄: /排泄|便|下痢|便秘|尿|トイレ|diarrhea|constipation|urinary|urination|stool|feces/i,
    '皮膚・被毛': /皮膚|被毛|脱毛|かゆ|アレルギー|skin|coat|hair|itch|allerg/i,
    '目・涙': /目|涙|眼|eye|vision|tear/i,
    耳: /耳|ear|hearing/i,
    '口・歯': /口|歯|歯周|dental|oral|tooth|teeth|gum/i,
    呼吸: /咳|呼吸|くしゃみ|肺|heart|cardiac|respirat|cough|pneumonia/i,
    '行動・しつけ': /行動|しつけ|散歩|不安|behavior|behaviour|training|anxiety|aggress/i,
    生活環境: /飼育|生活|環境|災害|暑|寒|welfare|environment|disaster|heat|cold|housing/i,
    '予防・通院': /予防|病院|ワクチン|感染|寄生虫|薬|vaccine|infect|parasite|medicin|prevent|veterinar/i,
    中毒: /中毒|毒|誤食|poison|toxi|xylitol|hazard/i,
    高齢: /高齢|シニア|senior|aging|ageing|geriatric/i,
    消化器: /嘔吐|吐く|胃|腸|膵|vomit|gastro|intestinal|pancrea/i,
    泌尿器: /腎|膀胱|尿|結石|kidney|renal|bladder|urinary/i,
    運動器: /関節|歩行|足|骨|arthritis|joint|bone|limp|orthop/i,
    神経: /けいれん|発作|神経|seizure|neurolog|brain|spinal/i,
    心臓: /心臓|心拍|循環|cardiac|heart|circulat/i,
    腫瘍: /腫瘍|がん|癌|しこり|cancer|tumor|tumour|oncolog/i,
  };
  return Object.entries(groups).filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}

function articleBody(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || html.match(/<div\b[^>]*(?:class|id)=["'][^"']*(?:field--name-body|main-content|content-area)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/(?:div|main|article)>/i)?.[1]
    || '';
  return plain(main).replace(/\n(?:Share|Related Content|Related Links|References)\b[\s\S]*$/i, '').trim();
}

function articleTitle(html) {
  const article = html.match(/<article\b[^>]*(?:id=["']main-article["'])?[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || html;
  return plain(article.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || '');
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  if (!(response.headers.get('content-type') || '').includes('text/html')) return '';
  return response.text();
}

function makeId(source, url) {
  return `authority-${createHash('sha256').update(`${source}\n${url}`).digest('hex').slice(0, 24)}`;
}

const articles = [];
const failures = [];
for (const source of sources) {
  const discovered = new Set(source.includeHubs ? source.hubs : []);
  for (const hub of source.hubs) {
    try {
      const html = await fetchHtml(hub);
      for (const url of links(html, hub)) if (source.allow.test(url)) discovered.add(url);
    } catch (error) { failures.push({ url: hub, error: String(error) }); }
  }
  const urls = [...discovered];
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      try {
        const html = await fetchHtml(url);
        const title = articleTitle(html);
        const body = articleBody(html);
        if (!title || body.length < 180) continue;
        const combined = `${title}\n${body}`;
        articles.push({ id: makeId(source.name, url), source: source.name, sourceUrl: url, sourceKind: source.kind,
          authorityRank: source.rank, language: source.language, title, animalType: source.animalType, tags: inferTags(combined), body: body.slice(0, 30000) });
      } catch (error) { failures.push({ url, error: String(error) }); }
      process.stdout.write(`\r${source.name}: ${Math.min(cursor, urls.length)}/${urls.length}`);
    }
  }));
  process.stdout.write('\n');
}

const unique = [...new Map(articles.map((article) => [article.sourceUrl, article])).values()]
  .sort((a, b) => b.authorityRank - a.authorityRank || a.source.localeCompare(b.source) || a.title.localeCompare(b.title));
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify({ fetchedAt: new Date().toISOString(), count: unique.length, sources: sources.map(({ name, kind, rank, language }) => ({ name, kind, rank, language })), failures, articles: unique }, null, 2)}\n`, 'utf8');
console.log(`Saved ${unique.length} authoritative articles to ${OUTPUT}; failures: ${failures.length}`);
