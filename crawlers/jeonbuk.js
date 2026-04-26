const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, normalizeLevel, extractLevel } = require('./utils');

const BASE_URL = 'https://www.jbe.go.kr';
const LIST_URL = `${BASE_URL}/pool/index.jbe?menuCd=DOM_000001601002000000`;

async function crawlJeonbuk() {
  const jobs = [];
  let page = 1;

  while (page <= 20) {
    const url = `${LIST_URL}&pageIndex=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[전북] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const rows = $('table tbody tr');

    if (rows.length === 0) break;

    let hasNew = false;
    rows.each((_, row) => {
      const tds = $(row).find('td');
      if (tds.length < 5) return;

      const schoolEl = $(tds[2]).find('a');
      const school = schoolEl.text().trim();
      const href = schoolEl.attr('href');
      const subject = $(tds[3]).text().trim();     // 과목/분야
      const rawLevel = $(tds[1]).text().trim();    // 구분 (초/중/고 등)
      const level = normalizeLevel(rawLevel) || extractLevel('', school);
      const periodText = $(tds[4]).text().trim();  // 접수기간

      if (!school) return;

      const dates = periodText.split('~');
      const deadline = parseDate(dates[1] || '');

      if (isExpired(deadline)) return;

      hasNew = true;
      jobs.push({
        id: `jeonbuk_${page}_${jobs.length}`,
        sido: '전북',
        school,
        subject,
        level,
        title: `${school} ${subject} 기간제교사`,
        deadline,
        url: href ? (href.startsWith('http') ? href : BASE_URL + href) : LIST_URL,
        source: 'jbe.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) break;
    page++;
  }

  console.log(`[전북] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlJeonbuk;
