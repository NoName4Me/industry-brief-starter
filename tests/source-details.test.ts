import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, db } from '../src/server/db.ts';
import { sources, articles } from '../src/server/schema.ts';
import { migrate } from './database-fixture.ts';
import { collectSource } from '../src/server/collect.ts';
import { sourceQualityData } from '../src/server/source-metrics.ts';
import { readSourceDetail } from '../src/server/source-details.ts';
import { saveSettings } from '../src/server/settings.ts';
import { defaultSettings } from '../src/server/types.ts';
if (!/_test$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw Error('必须使用_test数据库');
before(migrate);
beforeEach(async () => {
  await pool.query('TRUNCATE sources,articles,events,collection_runs CASCADE');
  await saveSettings({ ...defaultSettings, collectionEnabled: false });
});
after(() => pool.end());
const first = 'https://example.invalid/updates';
const second = 'https://example.invalid/notices';
const link = '/notices/01/index.html';
const listing = (date: string, url = link) =>
  `<table><tr><td><a href="${url}" title="完整政策标题">缩略标题…</a><span>${date}</span></td></tr></table>`;
test('多入口共享去重，只有窗口内未收录条目才抓详情，关闭时保留列表材料', async () => {
  const [source] = await db
    .insert(sources)
    .values({
      name: '政策来源',
      url: first,
      additionalUrls: [second],
      readDetails: true,
      format: 'html',
      industryId: 'general',
      enabled: true,
    })
    .returning();
  const called: string[] = [];
  const fetcher = async (url: string) => {
    called.push(url);
    return [first, second].includes(url)
      ? listing('2026-10-26') + listing('2026-09-01', link.replace('01/', '02/'))
      : '<h1>完整文件标题</h1><div id="zoom">这是政策正文，明确了适用主体、生效日期和执行要求，包含完整的文件内容。</div>';
  };
  await collectSource(source.id, fetcher, new Date('2026-10-29T00:00:00Z'), { manual: true });
  assert.equal(called.filter((u) => u === new URL(link, first).href).length, 1);
  assert.equal((await db.select().from(articles)).length, 1);
  assert.match((await db.select().from(articles))[0].excerpt, /适用主体/);
  await collectSource(source.id, fetcher, new Date('2026-10-29T00:00:00Z'), { manual: true });
  assert.equal(called.filter((u) => u === new URL(link, first).href).length, 1);
  await pool.query('DELETE FROM articles');
  await pool.query('UPDATE sources SET read_details=false WHERE id=$1', [source.id]);
  called.length = 0;
  await collectSource(source.id, fetcher, new Date('2026-10-29T00:00:00Z'), { manual: true });
  assert.equal(called.filter((url) => url === new URL(link, first).href).length, 1);
  assert.equal((await db.select().from(articles))[0].excerpt, '完整政策标题');
});
test('详情正文缺失会记录失败并继续其它入口，拒绝用标题代替正文', async () => {
  const [source] = await db
    .insert(sources)
    .values({
      name: '政策来源',
      url: first,
      additionalUrls: [second],
      readDetails: true,
      format: 'html',
      industryId: 'general',
      enabled: true,
    })
    .returning();
  const called: string[] = [];
  await assert.rejects(
    collectSource(
      source.id,
      async (url) => {
        called.push(url);
        return [first, second].includes(url)
          ? listing('2026-10-26')
          : '<nav>菜单</nav><h1>只有标题</h1>';
      },
      new Date('2026-10-29T00:00:00Z'),
      { manual: true },
    ),
    /正文区域/,
  );
  assert.ok(called.includes(second));
  assert.equal((await db.select().from(articles)).length, 0);
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM collection_items WHERE outcome='failed'"))
      .rows[0].n,
    2,
  );
});
test('仅含PDF的详情页读取附件正文，并拒绝跨站附件', async () => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream =
    'BT /F1 12 Tf 40 700 Td (This policy document defines scope and implementation requirements.) Tj ET';
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const url = 'https://example.invalid/notices/pdf';
  const result = await readSourceDetail(url, async (input, options) => {
    if (input.endsWith('.pdf')) {
      assert.equal(options?.binaryBase64, true);
      return Buffer.from(pdf).toString('base64');
    }
    return '<div id="BodyLabel"><a href="/file.pdf">下载文件</a></div>';
  });
  assert.match(result.excerpt, /implementation requirements/);
  await assert.rejects(
    readSourceDetail(
      url,
      async () => '<div id="BodyLabel"><a href="https://other.example/file.pdf">文件</a></div>',
    ),
    /同一官网/,
  );
});

test('纯图片资讯记为无有效文本，不阻断同批可读正文', async () => {
  const [source] = await db
    .insert(sources)
    .values({
      name: '政策网页',
      url: first,
      format: 'html',
      industryId: 'general',
      enabled: true,
      readDetails: true,
    })
    .returning();
  const image = link.replace('01/', '99/');
  const result = await collectSource(
    source.id,
    async (url) =>
      url === first
        ? listing('2026-10-28', image) + listing('2026-10-28')
        : url === new URL(image, first).href
          ? '<div id="zoom"><img src="/poster.jpg"><span style="color: rgb(255, 255, 255)">1</span></div>'
          : '<div id="zoom">这是一篇含有完整信息的政策正文，说明了政策内容、适用范围和执行要求。</div>',
    new Date('2026-10-29T08:00:00Z'),
    { manual: true },
  );
  assert.equal(result.inserted, 1);
  const outcomes = (await pool.query('SELECT outcome FROM collection_items ORDER BY id')).rows.map(
    (r) => r.outcome,
  );
  assert.deepEqual(outcomes, ['invalid', 'new']);
  const quality = await sourceQualityData(7, undefined, new Date('2026-10-29T08:00:00Z'));
  assert.equal(
    quality.discoveries.find((v) => v.url === new URL(image, first).href)?.state,
    'invalid',
  );
});
