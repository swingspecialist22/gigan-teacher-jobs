const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, isOldExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://www.jje.go.kr';
const LIST_URL = `${BASE_URL}/board/list.jje?boardId=BBS_0000507&menuCd=DOM_000000103003009000&listRow=20&paging=ok`;

async function crawlJeju() {
  const jobs = [];
  const seen = new Set();
  let page = 1;

  while (page <= 20) {
    const url = `${LIST_URL}&startPage=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[제주] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const rows = $('table tbody tr');
    if (rows.length === 0) break;

    let hasNew = false;
    let shouldStop = false;

    rows.each((_, row) => {
      const tds = $(row).find('td');
      if (tds.length < 5) return;

      const linkEl = tds.eq(1).find('a').first();
      const href = linkEl.attr('href') || '';
      const sidMatch = href.match(/dataSid=(\d+)/);
      if (!sidMatch) return;
      const dataSid = sidMatch[1];
      if (seen.has(dataSid)) return;
      seen.add(dataSid);

      const title = linkEl.text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      const school = tds.eq(2).text().trim();
      const deadline = parseDate(tds.eq(4).text().trim());

      if (isOldExpired(deadline)) { shouldStop = true; return; }
      if (isExpired(deadline)) return;

      hasNew = true;
      jobs.push({
        id: `jeju_${dataSid}`,
        sido: '제주',
        school,
        subject: extractSubject(title),
        level: extractLevel(title, school),
        title,
        deadline,
        url: `${BASE_URL}${href}`,
        source: 'jje.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew || shouldStop) break;
    page++;
  }

  console.log(`[제주] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlJeju;
