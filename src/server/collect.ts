import { publicationIndustryId } from '../publication/identity.ts';
import { sourceAdapters, type SourceItem } from '../publication/source-adapters.ts';
import { readSourceDetail, UnsupportedSourceContentError } from './source-details.ts';
import { provenanceSchema } from './types.ts';
import { observeSourceItem, recordCollectionItem } from './source-observations.ts';
import { pool } from './db.ts';
import { getSettings } from './settings.ts';
import { nextInterval } from './source-rhythm.ts';
import Parser from 'rss-parser';
import { parseHtmlItems, validateHtmlSourceUrl } from './html-source.ts';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from './db.ts';
import { articles, sources } from './schema.ts';
import { fetchSource, SourceHttpError, type SourceFetchOptions } from './fetch.ts';
export const articleInput = z.object({
  title: z.string().trim().min(1).max(500),
  url: z
    .url()
    .max(2000)
    .refine((v) => /^https?:/.test(v)),
  excerpt: z.string().trim().min(1).max(16000),
  publishedAt: z.iso.datetime({ offset: true }),
  sourceName: z.string().trim().min(1).max(200),
  industryId: z.string().default(publicationIndustryId),
  provenance: provenanceSchema.optional(),
  publishedPrecision: z.enum(['day', 'time', 'observed']).default('time'),
});
export function cleanText(text: string) {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
export async function parseRssItems(
  text: string,
  onInvalid?: (item: { title: string; url?: string }) => void,
) {
  const feed = await new Parser<
    unknown,
    { rawPubDate?: string; rawPublished?: string; rawUpdated?: string; rawDate?: string }
  >({
    customFields: {
      item: [
        ['pubDate', 'rawPubDate'],
        ['published', 'rawPublished'],
        ['updated', 'rawUpdated'],
        ['dc:date', 'rawDate'],
      ],
    },
  }).parseString(text);
  return feed.items.slice(0, 100).flatMap((item) => {
    const rawDate = (
      item.rawPubDate ??
      item.rawPublished ??
      item.rawUpdated ??
      item.rawDate
    )?.trim();
    if (!item.title || !item.link || !rawDate) {
      onInvalid?.({ title: item.title ? cleanText(item.title) : '无标题条目', url: item.link });
      return [];
    }
    // 未标注时区的来源时间统一按北京时间解释，与服务器所在时区无关。
    const date = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(rawDate)
      ? `${rawDate.length === 10 ? `${rawDate}T00:00:00` : rawDate.replace(' ', 'T')}+08:00`
      : /(?:Z|[+-]\d{2}:?\d{2}|[A-Z]{2,5})(?:\s*\([^)]*\))?$/i.test(rawDate)
        ? rawDate
        : `${rawDate} GMT+0800`;
    if (Number.isNaN(Date.parse(date))) {
      onInvalid?.({ title: cleanText(item.title), url: item.link });
      return [];
    }
    return [
      {
        title: cleanText(item.title).slice(0, 500),
        url: item.link,
        excerpt:
          cleanText(item.contentSnippet ?? item.content ?? '').slice(0, 16000) ||
          cleanText(item.title).slice(0, 500),
        publishedAt: new Date(date).toISOString(),
      },
    ];
  });
}
export function pageDescription(html: string) {
  let description = '';
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = Object.fromEntries(
      [...tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [
        m[1].toLowerCase(),
        m[2] ?? m[3],
      ]),
    );
    const key = attributes.property ?? attributes.name;
    if (key === 'og:description') return cleanText(attributes.content ?? '').slice(0, 16000);
    if (key === 'description') description = cleanText(attributes.content ?? '').slice(0, 16000);
  }
  return description;
}
export function canonicalUrl(input: string) {
  const url = new URL(input);
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid|gclid)/.test(key)) url.searchParams.delete(key);
  return url.href;
}
export async function importArticle(input: unknown, sourceId?: string) {
  const value = { ...articleInput.parse(input), industryId: publicationIndustryId };
  return db
    .insert(articles)
    .values({
      ...value,
      url: canonicalUrl(value.url),
      publishedAt: new Date(value.publishedAt),
      sourceId,
    })
    .onConflictDoNothing({ target: articles.url })
    .returning({ id: articles.id });
}
type SourceItemRejection = { title: string; url?: string };

export async function readSourceItems(
  url: string,
  format: string,
  fetcher: typeof fetchSource,
  now = new Date(),
  options: SourceFetchOptions = {},
  onInvalid?: (item: SourceItemRejection) => void,
): Promise<SourceItem[] | null> {
  if (format === 'html') validateHtmlSourceUrl(url);
  const endpoint = new URL(url);
  const adapter = sourceAdapters.find((candidate) => candidate.matches(endpoint, format));
  const request = adapter?.request?.(endpoint);
  const body = await fetcher(request?.url ?? url, { ...options, ...request?.options });
  if (body === null) return null;
  if (adapter) return adapter.parse(body, endpoint, now);
  if (format === 'rss') return parseRssItems(body, onInvalid);
  if (format === 'html') return parseHtmlItems(body, url, cleanText, now);
  const entries = z.array(z.unknown()).max(100).parse(JSON.parse(body));
  const schema = articleInput.omit({ sourceName: true, industryId: true });
  return entries.flatMap((entry) => {
    const parsed = schema.safeParse(entry);
    if (parsed.success) return [parsed.data];
    if (entry && typeof entry === 'object') {
      const item = entry as Record<string, unknown>;
      onInvalid?.({
        title: typeof item.title === 'string' ? item.title : '无标题条目',
        url: typeof item.url === 'string' ? item.url : undefined,
      });
    } else onInvalid?.({ title: '无标题条目' });
    return [];
  });
}
async function collectEndpoint(
  id: string,
  fetcher: (url: string, options?: SourceFetchOptions) => Promise<string | null> = fetchSource,
  now = new Date(),
  options: { manual?: boolean } = {},
  endpoint?: string,
) {
  const config = await getSettings();
  if (!config.collectionEnabled && !options.manual) throw new Error('采集尚未开启');
  const [stored] = await db.select().from(sources).where(eq(sources.id, id));
  const source = stored && {
    ...stored,
    url: endpoint ?? stored.url,
    etag: stored.additionalUrls.length || stored.readDetails ? null : stored.etag,
  };
  if (!source?.enabled) throw new Error('信源已停用或不存在');
  if (!source.url || source.format === 'manual') throw new Error('信源尚无可用采集入口');
  const {
    rows: [run],
  } = await pool.query(
    'INSERT INTO collection_runs(source_id,source_name,url) VALUES($1,$2,$3) RETURNING id',
    [id, source.name, source.url],
  );
  async function success(inserted: number, result: unknown) {
    const rhythm = nextInterval(source, { inserted });
    await db
      .update(sources)
      .set({
        intervalMinutes: rhythm.interval,
        quietRuns: rhythm.quiet,
        failureCount: 0,
        stableRuns: rhythm.stable,
        intervalReason: rhythm.reason,
        nextFetchAt: new Date(Date.now() + rhythm.interval * 60_000),
      })
      .where(eq(sources.id, id));
    await pool.query(
      "UPDATE collection_runs SET state='succeeded',finished_at=now(),result=$2 WHERE id=$1",
      [run.id, JSON.stringify(result)],
    );
  }
  try {
    let etag = source.etag;
    const rejected: SourceItemRejection[] = [];
    const itemsResult = await readSourceItems(
      source.url,
      source.format,
      fetcher,
      now,
      {
        etag,
        onHeaders: (headers) => {
          etag = headers.etag;
        },
      },
      (item) => rejected.push(item),
    );
    const nextFetchAt = new Date(Date.now() + source.intervalMinutes * 60_000);
    if (itemsResult === null) {
      await db
        .update(sources)
        .set({ lastFetchedAt: new Date(), lastError: null, nextFetchAt })
        .where(eq(sources.id, id));
      await success(0, { fetched: 0, inserted: 0, unchanged: true });
      return { fetched: 0, inserted: 0, unchanged: true };
    }
    let items = itemsResult;
    for (const item of rejected) await recordCollectionItem(run.id, id, item, 'invalid', now);
    const eligible: typeof items = [];
    for (const item of items) {
      const parsed = articleInput.safeParse({
        ...item,
        sourceName: item.sourceName ?? source.name,
      });
      if (!parsed.success) {
        await recordCollectionItem(run.id, id, item, 'invalid', now);
        continue;
      }
      const published = new Date(item.publishedAt).getTime();
      if (published < now.getTime() - 7 * 86400_000 || published > now.getTime()) {
        await recordCollectionItem(run.id, id, item, 'outside_window', now);
        continue;
      }
      eligible.push({ ...item, url: canonicalUrl(item.url) });
    }
    items = eligible;
    // 用信源自身列表的新增判断节奏，避免跨信源去重影响更新频率。
    const previous = await pool.query(
      "SELECT result->'urls' AS urls FROM collection_runs WHERE source_id=$1 AND state='succeeded' AND result ? 'urls' ORDER BY finished_at DESC LIMIT 1",
      [id],
    );
    const previousUrls = new Set<string>(previous.rows[0]?.urls ?? []);
    const urls = [...new Set(items.map((item) => canonicalUrl(item.url)))];
    const sourceNew = urls.filter((url) => !previousUrls.has(url)).length;
    let inserted = 0;
    const detailErrors: Error[] = [];
    for (const item of items) {
      const exists = await db
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.url, canonicalUrl(item.url)))
        .limit(1);
      const first = await observeSourceItem(id, item, now);
      if (exists.length) {
        await recordCollectionItem(run.id, id, item, first ? 'known' : 'repeated', now);
        continue;
      }
      if (source.readDetails && !item.contentComplete) {
        try {
          Object.assign(item, await readSourceDetail(item.url, fetcher));
        } catch (error) {
          if (error instanceof UnsupportedSourceContentError) {
            await recordCollectionItem(run.id, id, item, 'invalid', now);
            continue;
          }
          await recordCollectionItem(run.id, id, item, 'failed', now);
          detailErrors.push(
            new Error(`${item.title}：${error instanceof Error ? error.message : '详情读取失败'}`, {
              cause: error,
            }),
          );
          continue;
        }
      }
      if (!source.readDetails && item.excerpt === item.title && !item.provenance) {
        try {
          const html = await fetcher(item.url);
          if (html) item.excerpt = pageDescription(html) || item.title;
        } catch (error) {
          // 简介是额外材料，原页不可读时只保留订阅中实际提供的标题。
          console.warn(
            '信源条目简介读取失败：',
            item.url,
            error instanceof Error ? error.message : '读取失败',
          );
        }
      }
      let saved: number;
      try {
        saved = (
          await importArticle(
            {
              ...item,
              industryId: publicationIndustryId,
              sourceName: item.sourceName ?? source.name,
            },
            source.id,
          )
        ).length;
      } catch (error) {
        await recordCollectionItem(run.id, id, item, 'failed', now);
        throw error;
      }
      inserted += saved;
      if (saved)
        await pool.query(
          'UPDATE source_discoveries SET inserted=true WHERE source_id=$1 AND url=$2',
          [id, item.url],
        );
      await observeSourceItem(id, item, now);
      await recordCollectionItem(
        run.id,
        id,
        item,
        saved ? 'new' : first ? 'known' : 'repeated',
        now,
      );
    }
    await db
      .update(sources)
      .set({ lastFetchedAt: new Date(), lastError: null, etag, nextFetchAt })
      .where(eq(sources.id, id));
    if (detailErrors.length)
      throw new AggregateError(
        detailErrors,
        detailErrors
          .map((error) => error.message)
          .join('；')
          .slice(0, 1000),
      );
    await success(sourceNew, { fetched: items.length, inserted, sourceNew, urls });
    return { fetched: items.length, inserted };
  } catch (error) {
    const rhythm = nextInterval(source, { failed: true });
    const retryMinutes = rhythm.interval;
    await pool.query(
      "UPDATE collection_runs SET state='failed',finished_at=now(),error=$2 WHERE id=$1",
      [run.id, error instanceof Error ? error.message.slice(0, 1000) : '采集失败'],
    );
    await db
      .update(sources)
      .set({
        lastFetchedAt: new Date(),
        intervalMinutes: source.autoInterval ? rhythm.interval : source.intervalMinutes,
        quietRuns: rhythm.quiet,
        failureCount: rhythm.failures,
        stableRuns: rhythm.stable,
        intervalReason: rhythm.reason,
        nextFetchAt:
          error instanceof SourceHttpError && error.retryAt
            ? new Date(Math.max(error.retryAt.getTime(), Date.now() + retryMinutes * 60_000))
            : new Date(Date.now() + retryMinutes * 60_000),
        lastError: error instanceof Error ? error.message.slice(0, 300) : '采集失败',
      })
      .where(eq(sources.id, id));
    throw error;
  }
}

export async function collectSource(
  id: string,
  fetcher = fetchSource,
  now = new Date(),
  options: { manual?: boolean } = {},
) {
  const [source] = await db.select().from(sources).where(eq(sources.id, id));
  if (!source?.additionalUrls.length) return collectEndpoint(id, fetcher, now, options);
  let fetched = 0,
    inserted = 0;
  const errors: Error[] = [];
  for (const endpoint of [source.url!, ...source.additionalUrls]) {
    try {
      const result = await collectEndpoint(id, fetcher, now, options, endpoint);
      fetched += result.fetched;
      inserted += result.inserted;
    } catch (e) {
      errors.push(
        new Error(`${endpoint}：${e instanceof Error ? e.message : '采集失败'}`, { cause: e }),
      );
    }
  }
  if (errors.length) {
    const message = errors.map((error) => error.message).join('；');
    await pool.query(
      'UPDATE sources SET last_error=$2,failure_count=greatest(failure_count,1) WHERE id=$1',
      [id, message.slice(0, 1000)],
    );
    throw new AggregateError(errors, message);
  }
  return { fetched, inserted };
}
