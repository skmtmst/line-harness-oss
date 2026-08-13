import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = resolve(process.cwd(), 'data/nen-knowledge-pfirst.json');
const output = resolve(process.cwd(), 'data/nen-knowledge-pfirst.sql');
const payload = JSON.parse(await readFile(input, 'utf8'));
const q = (value) => `'${String(value ?? '').replaceAll("'", "''")}'`;
const rows = payload.articles.map((article) => `INSERT INTO nen_knowledge_articles
  (id, source_name, source_url, title, animal_type, tags_json, body, fetched_at, is_active, created_at, updated_at)
VALUES (${q(article.id)}, ${q(article.source)}, ${q(article.sourceUrl)}, ${q(article.title)}, ${q(article.animalType)}, ${q(JSON.stringify(article.tags))}, ${q(article.body)}, ${q(payload.fetchedAt)}, 1, ${q(payload.fetchedAt)}, ${q(payload.fetchedAt)})
ON CONFLICT(id) DO UPDATE SET source_name=excluded.source_name, source_url=excluded.source_url,
  title=excluded.title, animal_type=excluded.animal_type, tags_json=excluded.tags_json,
  body=excluded.body, fetched_at=excluded.fetched_at, is_active=1, updated_at=excluded.updated_at;`);
await writeFile(output, `-- Generated from ${payload.sourceUrl}; ${payload.count} source-attributed articles.\n${rows.join('\n')}\n`, 'utf8');
console.log(`Saved ${rows.length} statements to ${output}`);
