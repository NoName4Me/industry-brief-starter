import { load } from 'cheerio';

export function validateHtmlSourceUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('网页采集入口必须是公开的 HTTPS 地址');
}

const navigation =
  /^(首页|更多|登录|注册|退出|下一页|上一页|返回|English|中文|关于我们|联系我们|网站地图|版权声明|用户协议|隐私政策|广告服务|招聘|友情链接|设为首页|加入收藏|企业社会责任|集团网站|网站声明|人才招聘|客户服务|网点查询)$/;
const datePattern = /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*日?/;
const months: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
// 英文站点常见 “October 27, 2026” 或 “27 October 2026” 两种顺序。
function englishDate(context: string) {
  const m =
    /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(context) ??
    /(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/.exec(context);
  if (!m) return null;
  const monthName = (months[m[1].toLowerCase()] ? m[1] : m[2]).toLowerCase();
  const day = Number(months[m[1].toLowerCase()] ? m[2] : m[1]);
  const year = Number(m[3]);
  const month = months[monthName];
  if (!month || !day || !year) return null;
  return [year, month, day] as const;
}

// 通用网页列表适配：同一站点的文章链接，附近带有年月日即视为一条候选。
// 只取日期级时间，并交由采集流程按时间窗过滤；无法确认日期的链接不进入候选。
export function parseGenericHtmlItems(
  text: string,
  input: string,
  clean: (value: string) => string,
  now = new Date(),
) {
  const origin = new URL(input).origin;
  const seen = new Set<string>();
  const items: {
    title: string;
    url: string;
    excerpt: string;
    publishedAt: string;
    publishedPrecision: 'day';
  }[] = [];
  const $ = load(text);
  $('nav,header,footer,aside,script,style').remove();
  for (const element of $('a[href]').toArray()) {
    const anchor = $(element);
    let url: URL;
    try {
      url = new URL(anchor.attr('href')!, input);
    } catch {
      continue;
    }
    if (url.origin !== origin || seen.has(url.href)) continue;
    if (/\.(?:jpg|jpeg|png|gif|svg|webp|css|js|pdf|zip|rar|mp4)$/i.test(url.pathname)) continue;
    const title = clean(anchor.attr('title') || anchor.text()).replace(/^[•·\-–—|]+\s*/, '');
    if (!title || title.length < 6 || title.length > 180 || navigation.test(title)) continue;
    const containers = anchor.parents().slice(0, 4).toArray();
    const item = containers
      .map((container) => $(container))
      .find((container) => {
        const links = container.find('a[href]').toArray();
        return (
          links.every((link) => $(link).attr('href') === anchor.attr('href')) &&
          (datePattern.test(container.text()) || englishDate(container.text()))
        );
      });
    if (!item) continue;
    const context = item.text();
    const date = datePattern.exec(context);
    const parsed = date
      ? ([Number(date[1]), Number(date[2]), Number(date[3])] as const)
      : englishDate(context);
    if (!parsed) continue;
    const [year, month, day] = parsed;
    if (year < 2020 || month < 1 || month > 12 || day < 1 || day > 31) continue;
    const dateLabel = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const publishedAt = `${dateLabel}T00:00:00+08:00`;
    const time = Date.parse(publishedAt);
    if (Number.isNaN(time) || time > now.getTime() + 86400000) continue;
    if (new Date(`${dateLabel}T00:00:00Z`).toISOString().slice(0, 10) !== dateLabel) continue;
    seen.add(url.href);
    items.push({
      title,
      url: url.href,
      excerpt: clean(item.find('p').first().text()) || title,
      publishedAt,
      publishedPrecision: 'day',
    });
    if (items.length >= 100) break;
  }
  return items;
}
export function parseHtmlItems(
  text: string,
  input: string,
  clean: (value: string) => string,
  now = new Date(),
) {
  validateHtmlSourceUrl(input);
  return parseGenericHtmlItems(text, input, clean, now);
}
