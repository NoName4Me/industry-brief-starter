import { migrate as migrateSchema } from '../scripts/migrate.ts';
import { pool } from '../src/server/db.ts';

export async function migrate() {
  await migrateSchema();
  await pool.query(
    "INSERT INTO industries (id,name,description,sections,position) VALUES ('finance','金融','历史刊期测试数据','[\"行业监管\",\"行业进展\",\"相关报告\"]',1) ON CONFLICT DO NOTHING",
  );
}
