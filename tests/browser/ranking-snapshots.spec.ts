import { test, expect } from '@playwright/test';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { localDate } from '../../src/server/periods.ts';
test('榜单快照可展开查看项目、名次和采集时间', async ({ page }) => {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const id = randomUUID();
  const now = new Date();
  const boardUrl = 'https://example.invalid/ranking';
  const snapshot = {
    boardUrl,
    observedAt: now.toISOString(),
    entries: [
      {
        key: 'project-a',
        name: '项目甲',
        url: 'https://example.invalid/projects/a',
        rank: 1,
        metric: '100 次公开使用',
        description: '实务工具',
      },
    ],
  };
  const item = {
    url: boardUrl + '?snapshot=1',
    title: '工具使用榜快照',
    excerpt: '项目甲位列第一，记录 100 次公开使用。',
    provenance: {
      itemId: 'snapshot-1',
      category: '榜单快照',
      canonical: boardUrl,
      attribution: { name: '公开榜单', url: boardUrl },
      snapshot,
    },
  };
  try {
    await db.query(
      "INSERT INTO sources(id,name,url,format,industry_id,verification_status) VALUES($1,'快照信源','https://example.invalid/ranking','html','general','approved')",
      [id],
    );
    await db.query(
      "INSERT INTO articles(source_id,source_name,url,title,excerpt,published_at,published_precision,provenance,industry_id) VALUES($1,'快照信源',$2,$3,$4,$5,'observed',$6,'general')",
      [id, item.url, item.title, item.excerpt, now, JSON.stringify(item.provenance)],
    );
    await db.query(
      'INSERT INTO source_discoveries(source_id,url,title,published_at,first_seen_at,last_seen_at,inserted) VALUES($1,$2,$3,$4,$4,$4,true)',
      [id, item.url, item.title, now],
    );
    await page.goto('/login');
    await page.getByLabel('管理员密码').fill(process.env.ADMIN_PASSWORD!);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto(`/admin/sources/monitor?source=${id}&date=${localDate(now)}`);
    const table = page.getByRole('table', { name: '每日采集明细' });
    await expect(table.getByRole('columnheader', { name: '资讯时间', exact: true })).toBeVisible();
    await expect(table).toContainText('采集于');
    await table.getByText(item.title, { exact: true }).click();
    await expect(table.getByRole('link', { name: '项目甲', exact: true })).toBeVisible();
    await expect(table).toContainText('100 次公开使用');
    await expect(table).toContainText('实务工具');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(table.getByRole('link', { name: '项目甲', exact: true })).toBeVisible();
  } finally {
    await db.query('DELETE FROM articles WHERE source_id=$1', [id]);
    await db.query('DELETE FROM sources WHERE id=$1', [id]);
    await db.end();
  }
});
