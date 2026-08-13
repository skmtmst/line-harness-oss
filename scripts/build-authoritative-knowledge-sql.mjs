import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = resolve(process.cwd(), 'data/nen-knowledge-authoritative.json');
const output = resolve(process.cwd(), 'data/nen-knowledge-authoritative.sql');
const payload = JSON.parse(await readFile(input, 'utf8'));
const q = (value) => `'${String(value ?? '').replaceAll("'", "''")}'`;
const rows = payload.articles.map((article) => `INSERT INTO nen_knowledge_articles
  (id, source_name, source_url, source_kind, authority_rank, language, title, animal_type, tags_json, body, fetched_at, is_active, created_at, updated_at)
VALUES (${q(article.id)}, ${q(article.source)}, ${q(article.sourceUrl)}, ${q(article.sourceKind)}, ${Number(article.authorityRank)}, ${q(article.language)}, ${q(article.title)}, ${q(article.animalType)}, ${q(JSON.stringify(article.tags))}, ${q(article.body)}, ${q(payload.fetchedAt)}, 1, ${q(payload.fetchedAt)}, ${q(payload.fetchedAt)})
ON CONFLICT(id) DO UPDATE SET source_name=excluded.source_name, source_url=excluded.source_url,
  source_kind=excluded.source_kind, authority_rank=excluded.authority_rank, language=excluded.language,
  title=excluded.title, animal_type=excluded.animal_type, tags_json=excluded.tags_json,
  body=excluded.body, fetched_at=excluded.fetched_at, is_active=1, updated_at=excluded.updated_at;`);
await writeFile(output, `-- ${payload.count} source-attributed records from authoritative veterinary and public-health sources.\n${rows.join('\n')}\n`, 'utf8');
console.log(`Saved ${rows.length} statements to ${output}`);
