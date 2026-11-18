import crypto from 'node:crypto';
import Parser from 'rss-parser';
import { config } from '../../config.js';
import { db, uuid } from '../../db/index.js';
import { notify } from '../../lib/notify.js';

const parser = new Parser({ timeout: 15_000 });

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);

export type NewsIngestResult = {
  configured: boolean;
  feeds: number;
  inserted: number;
  skipped: number;
  errors: Array<{ feed: string; error: string }>;
};

type FeedConfig = { url: string; scope: 'nacional' | 'internacional'; category: string; name?: string };

/** Formato: url | scope | categoría | nombre (los tres últimos opcionales). */
export function parseFeedList(raw: string[]): FeedConfig[] {
  return raw.map((entry): FeedConfig => {
    const [url, scope, category, name] = entry.split('|').map((s) => s.trim());
    return {
      url,
      scope: scope === 'internacional' ? 'internacional' : 'nacional',
      category: category || 'Actualidad jurídica',
      name: name || undefined,
    };
  }).filter((f) => /^https?:\/\//.test(f.url));
}

function extractImage(item: any): string | null {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item['media:content']?.$?.url) return item['media:content'].$.url;
  if (item['media:thumbnail']?.$?.url) return item['media:thumbnail'].$.url;
  const html = item['content:encoded'] ?? item.content ?? '';
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return match?.[1] ?? null;
}

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export async function ingestNews(): Promise<NewsIngestResult> {
  const feeds = parseFeedList(config.news.feeds);
  const result: NewsIngestResult = { configured: feeds.length > 0 || Boolean(config.news.newsApiKey), feeds: feeds.length, inserted: 0, skipped: 0, errors: [] };

  const runId = uuid();
  const finishRun = (error: string | null) => {
    db.prepare(`
      UPDATE ingest_runs
      SET finished_at = datetime('now'), status = ?, stats = ?, error = ?
      WHERE id = ?
    `).run(
      'done',
      JSON.stringify({ feeds: feeds.length, inserted: result.inserted, skipped: result.skipped, errors: result.errors.length }),
      error,
      runId,
    );
  };
  db.prepare(`INSERT INTO ingest_runs (id, source_key, started_at, status) VALUES (?, 'news', datetime('now'), 'running')`).run(runId);

  if (!result.configured) {
    finishRun(null);
    return result;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO news
      (id, external_id, title, summary, body, source_name, source_url, image_url, country, scope, category, relevance, published_at, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const sourceName = feed.name ?? parsed.title ?? new URL(feed.url).hostname;
      for (const item of parsed.items.slice(0, 40)) {
        const link = item.link ?? '';
        if (!link) continue;
        const title = (item.title ?? '').trim();
        if (!title) continue;
        const externalId = hash(`${feed.url}::${item.guid ?? link}`);
        const summary = strip(item.contentSnippet ?? item.summary ?? '').slice(0, 600);
        // Guardamos solo título, resumen y enlace: no reproducimos el texto
        // completo de fuentes externas. La ficha invita a leer la original.
        const body = null;
        const published = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null);
        const info = insert.run(
          uuid(), externalId, title, summary, body, sourceName, link, extractImage(item),
          feed.scope === 'internacional' ? 'Internacional' : 'Perú', feed.scope, feed.category,
          null, published, hash(title + link),
        );
        if (info.changes > 0) result.inserted++;
        else result.skipped++;
      }
    } catch (err) {
      result.errors.push({ feed: feed.url, error: (err as Error).message });
    }
  }

  if (config.news.newsApiKey) {
    try {
      const url = new URL('https://newsapi.org/v2/everything');
      url.searchParams.set('q', '(Perú OR peruano) AND (derecho OR legal OR judicial OR ley OR tribunal)');
      url.searchParams.set('language', 'es');
      url.searchParams.set('sortBy', 'publishedAt');
      url.searchParams.set('pageSize', '20');
      const res = await fetch(url, { headers: { 'X-Api-Key': config.news.newsApiKey } });
      if (!res.ok) throw new Error(`NewsAPI ${res.status}`);
      const json = (await res.json()) as { articles?: any[] };
      for (const a of json.articles ?? []) {
        if (!a.url || !a.title) continue;
        const externalId = hash(`newsapi::${a.url}`);
        const info = insert.run(
          uuid(), externalId, a.title, strip(a.description ?? '').slice(0, 600), null,
          a.source?.name ?? 'NewsAPI', a.url, a.urlToImage ?? null, 'Perú', 'nacional', 'Actualidad jurídica',
          null, a.publishedAt ?? null, hash(a.title + a.url),
        );
        if (info.changes > 0) result.inserted++;
        else result.skipped++;
      }
    } catch (err) {
      result.errors.push({ feed: 'newsapi', error: (err as Error).message });
    }
  }

  finishRun(result.errors.length
    ? result.errors.map((error) => `${error.feed}: ${error.error}`).join('; ').slice(0, 2000)
    : null);

  if (result.inserted > 0) {
    const followers = db.prepare(`
      SELECT DISTINCT f.user_id FROM follows f WHERE f.target_type = 'area'
    `).all() as Array<{ user_id: string }>;
    for (const f of followers) {
      notify(f.user_id, 'news', 'Nuevas noticias jurídicas', `${result.inserted} publicaciones nuevas en ETON NEWS.`, '/noticias');
    }
  }

  return result;
}
