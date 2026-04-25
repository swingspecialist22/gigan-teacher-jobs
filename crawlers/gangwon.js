const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://www.gwe.go.kr';
const LIST_URL = `${BASE_URL}/main/bbs/list.do`;
const KEY = 'bTIzMDcyMTA1ODU2MzM%3D';


async function crawlGangwon() {
  const jobs = [];
  let page = 1;

  while (page <= 20) {
    const url = `${LIST_URL}?key=${KEY}&bbsCtgrySn=25&pageIndex=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[강원] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const items = $('a[onclick*="goView("]');
    if (items.length === 0) break;

    let hasNew = false;
    items.each((_, a) => {
      const onclick = $(a).attr('onclick') || '';
      const idMatch = onclick.match(/goView\('(\d+)'/);
      if (!idMatch) return;
      const sn = idMatch[1];

      // 제목: title 속성 또는 링크 텍스트
      const title = ($(a).attr('title') || $(a).text()).replace(/\s+/g, ' ').trim();
      if (!title) return;

      const tds = $(a).closest('tr').find('td');
      // td[4]: 학교명, td[5]: 접수마감
      const school = tds.eq(4).text().trim();
      const deadline = parseDate(tds.eq(5).text().trim());

      if (isExpired(deadline)) return;

      hasNew = true;
      jobs.push({
        id: `gangwon_${sn}`,
        sido: '강원',
        school,
        subject: extractSubject(title),
        level: extractLevel(title),
        title,
        deadline,
        url: `${BASE_URL}/main/bbs/view.do?key=${KEY}&sn=${sn}`,
        source: 'gwe.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) break;
    page++;
  }

  console.log(`[강원] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlGangwon;
