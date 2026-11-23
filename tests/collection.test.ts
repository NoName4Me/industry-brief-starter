import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/server/db.ts';
import { sources, articles } from '../src/server/schema.ts';
import { getSettings, saveSettings } from '../src/server/settings.ts';
import { migrate } from './database-fixture.ts';
import { collectSource } from '../src/server/collect.ts';
if (!process.env.DATABASE_URL || !/_test$/.test(new URL(process.env.DATABASE_URL).pathname))
  throw new Error('采集测试必须连接独立 _test 库');
before(async () => {
  await migrate();
  await pool.query('TRUNCATE articles,sources CASCADE');
});
after(async () => {
  await pool.end();
});
test('RSS采集保留明确时区、缺省按北京时间，跳过缺失日期且重复不新增', async () => {
  await saveSettings({ ...(await getSettings()), collectionEnabled: true });
  const [source] = await db
    .insert(sources)
    .values({
      name: '本地RSS测试',
      url: 'https://example.invalid/feed',
      format: 'rss',
      industryId: 'finance',
      enabled: true,
    })
    .returning();
  const rss = async () =>
    `<rss version="2.0"><channel><title>Test</title><link>https://example.invalid</link><description>local fixture</description><item><title>有日期</title><link>https://example.invalid/rss/1</link><description>来源摘要</description><pubDate>Thu, 22 Oct 2026 07:30:00 +0800</pubDate></item><item><title>无日期</title><link>https://example.invalid/rss/2</link></item><item><title>缺少时区</title><link>https://example.invalid/rss/3</link><pubDate>2026-10-22 07:30:00</pubDate></item></channel></rss>`;
  assert.deepEqual(await collectSource(source.id, rss, new Date('2026-10-23T00:00:00Z')), {
    fetched: 2,
    inserted: 2,
  });
  assert.deepEqual(await collectSource(source.id, rss, new Date('2026-10-23T00:00:00Z')), {
    fetched: 2,
    inserted: 0,
  });
  const [article] = await db.select().from(articles).where(eq(articles.sourceId, source.id));
  assert.equal(article.publishedAt.toISOString(), '2026-10-21T23:30:00.000Z');
  const imported = await db.select().from(articles).where(eq(articles.sourceId, source.id));
  assert.equal(imported.length, 2);
  assert.ok(imported.every((row) => row.publishedAt.toISOString() === '2026-10-21T23:30:00.000Z'));
  const [saved] = await db.select().from(sources).where(eq(sources.id, source.id));
  assert.ok(saved.lastFetchedAt);
  assert.equal(saved.lastError, null);
});
test('采集开关关闭时不会访问源；失败可在信源管理中看到', async () => {
  const [source] = await db
    .insert(sources)
    .values({
      name: '错误测试',
      url: 'https://example.invalid/error',
      format: 'json',
      industryId: 'general',
      enabled: true,
    })
    .returning();
  await saveSettings({ ...(await getSettings()), collectionEnabled: false });
  let called = false;
  await assert.rejects(
    () =>
      collectSource(source.id, async () => {
        called = true;
        return '[]';
      }),
    /未开启/,
  );
  assert.equal(called, false);
  await saveSettings({ ...(await getSettings()), collectionEnabled: true });
  await assert.rejects(
    () =>
      collectSource(source.id, async () => {
        throw new Error('本地假服务错误');
      }),
    /假服务/,
  );
  const [saved] = await db.select().from(sources).where(eq(sources.id, source.id));
  assert.equal(saved.lastError, '本地假服务错误');
});

test('遵守上游Retry-After，失败不会一分钟内反复采集', async () => {
  const { SourceHttpError } = await import('../src/server/fetch.ts');
  await saveSettings({ ...(await getSettings()), collectionEnabled: true });
  const [source] = await db
    .insert(sources)
    .values({
      name: '限流源',
      url: 'https://example.invalid/rate-limit',
      format: 'json',
      industryId: 'general',
      enabled: true,
    })
    .returning();
  const retryAt = new Date(Date.now() + 2 * 3600_000);
  await assert.rejects(
    () =>
      collectSource(source.id, async () => {
        throw new SourceHttpError(429, retryAt);
      }),
    /429/,
  );
  const [saved] = await db.select().from(sources).where(eq(sources.id, source.id));
  assert.ok(saved.nextFetchAt!.getTime() >= retryAt.getTime());
});
test('RSS只导入近期条目，缺少摘要时读取页面公开简介', async () => {
  const [source] = await db
    .insert(sources)
    .values({
      name: '官方博客',
      url: 'https://example.invalid/archive',
      format: 'rss',
      industryId: 'general',
      enabled: true,
    })
    .returning();
  const rss =
    '<rss version="2.0"><channel><title>test</title><link>https://example.invalid</link><description>test</description><item><title>新文章</title><link>https://example.invalid/new</link><pubDate>Thu, 22 Oct 2026 07:30:00 +0800</pubDate></item><item><title>旧文章</title><link>https://example.invalid/old</link><pubDate>Wed, 22 Oct 2025 07:30:00 +0800</pubDate></item></channel></rss>';
  const result = await collectSource(
    source.id,
    async (url) =>
      url === source.url ? rss : '<meta content="官方提供的简介" property="og:description">',
    new Date('2026-10-23T00:00:00Z'),
  );
  assert.equal(result.inserted, 1);
  const [article] = await db.select().from(articles).where(eq(articles.sourceId, source.id));
  assert.equal(article.excerpt, '官方提供的简介');
});

test('原页简介读取失败不阻断订阅，不编造摘要', async () => {
  const [source] = await db
    .insert(sources)
    .values({
      name: '简介不可读',
      url: 'https://example.invalid/meta-failure-feed',
      format: 'rss',
      industryId: 'general',
      enabled: true,
    })
    .returning();
  const rss =
    '<rss version="2.0"><channel><title>test</title><link>https://example.invalid</link><description>test</description><item><title>只有标题</title><link>https://example.invalid/meta-failure</link><pubDate>Thu, 22 Oct 2026 07:30:00 +0800</pubDate></item></channel></rss>';
  const result = await collectSource(
    source.id,
    async (url) => {
      if (url === source.url) return rss;
      throw new Error('本地TLS失败样本');
    },
    new Date('2026-10-23T00:00:00Z'),
  );
  assert.equal(result.inserted, 1);
  const [article] = await db.select().from(articles).where(eq(articles.sourceId, source.id));
  assert.equal(article.excerpt, '只有标题');
});

test('带token的RSS使用配置原址，手动采集不受专属冷却限制', async () => {
  const url = 'https://mcp.applications.jiqizhixin.com/rss?token=test-token';
  const [source] = await db
    .insert(sources)
    .values({ name: 'RSS完整入口', url, format: 'rss', industryId: 'general', enabled: true })
    .returning();
  await saveSettings({ ...(await getSettings()), collectionEnabled: true });
  let requests = 0;
  const rss = async (input: string) => {
    assert.equal(input, url);
    requests++;
    return `<rss version="2.0"><channel><title>local</title><link>https://example.invalid</link><description>test</description><item><title>研究报道</title><link>https://example.invalid/jiqi-rate</link><description>这是研究报道提供的真实摘要内容</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
  };
  await collectSource(source.id, rss);
  await collectSource(source.id, rss, undefined, { manual: true });
  assert.equal(requests, 2);
  assert.equal(
    (await pool.query('SELECT count(*)::int n FROM articles WHERE source_id=$1', [source.id]))
      .rows[0].n,
    1,
  );
});

test('调频读取信源自身新增量，跨信源去重及304不误判更新节奏', async () => {
  await saveSettings({ ...(await getSettings()), collectionEnabled: true });
  const [source] = await db
    .insert(sources)
    .values({
      name: '节奏测试',
      url: 'https://example.invalid/rhythm',
      format: 'json',
      industryId: 'general',
      enabled: true,
      autoInterval: true,
      intervalMinutes: 30,
      minIntervalMinutes: 10,
      maxIntervalMinutes: 120,
      stableRuns: 3,
    })
    .returning();
  const now = new Date('2026-10-23T00:00:00Z');
  const item = {
    title: '已有资讯',
    url: 'https://example.invalid/cross-source-rhythm',
    excerpt: '已有摘要',
    publishedAt: '2026-10-22T00:00:00Z',
  };
  const { importArticle } = await import('../src/server/collect.ts');
  await importArticle({ ...item, sourceName: '其他信源', industryId: 'general' });
  const fetcher = async () => JSON.stringify([item]);
  assert.equal((await collectSource(source.id, fetcher, now)).inserted, 0);
  assert.equal(
    (await db.select().from(sources).where(eq(sources.id, source.id)))[0].intervalMinutes,
    60,
  );
  await collectSource(source.id, async () => null, now);
  await collectSource(source.id, fetcher, now);
  const last = await pool.query(
    'SELECT result FROM collection_runs WHERE source_id=$1 ORDER BY finished_at DESC LIMIT 1',
    [source.id],
  );
  assert.equal(last.rows[0].result.sourceNew, 0);
  const saved = (await db.select().from(sources).where(eq(sources.id, source.id)))[0];
  assert.equal(saved.intervalMinutes, 60);
  assert.equal(saved.quietRuns, 2);
});
