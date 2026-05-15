const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://www.gwe.go.kr';
const LIST_URL = `${BASE_URL}/main/bbs/list.do`;
const KEY = 'bTIzMDcyMTA1ODU2MzM%3D';


async function crawlGangwon() {
  const jobs = [];
  const seen = new Set();
  let page = 1;
  let emptyPages = 0;

  while (page <= 20) {
    const url = `${LIST_URL}?key=${KEY}&pageIndex=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[강원] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    // 컬럼 순서: 번호(0), 제목(1), 작성일(2), 채용여부(3), 기관명(4), 마감일자(5), 파일(6)
    // onclick이 tr에 있을 수도, a에 있을 수도 있으므로 tbody tr 전체를 순회
    const rows = $('table tbody tr').filter((_, tr) => $(tr).find('td').length >= 5);
    if (rows.length === 0) break;

    let hasNew = false;
    rows.each((_, tr) => {
      const tds = $(tr).find('td');

      // ID: tr 또는 a의 onclick에서 goView ID 추출, 없으면 번호 컬럼 사용
      let sn = '';
      const trOnclick = $(tr).attr('onclick') || '';
      const aOnclick = $(tr).find('a[onclick]').first().attr('onclick') || '';
      const onclickStr = trOnclick || aOnclick;
      const idMatch = onclickStr.match(/goView\('?(\d+)'?\)/);
      if (idMatch) {
        sn = idMatch[1];
      } else {
        sn = tds.eq(0).text().trim();
      }
      if (!sn) return;
      if (seen.has(sn)) return;
      seen.add(sn);

      // 제목: td[1]의 a 텍스트 또는 td[1] 텍스트
      const titleEl = tds.eq(1).find('a').first();
      const title = (titleEl.attr('title') || titleEl.text() || tds.eq(1).text())
        .replace(/\s+/g, ' ').trim();
      if (!title) return;

      const school = tds.eq(4).text().trim();
      const deadline = parseDate(tds.eq(5).text().trim());

      if (isExpired(deadline)) return;

      hasNew = true;
      jobs.push({
        id: `gangwon_${sn}`,
        sido: '강원',
        school,
        subject: extractSubject(title),
        level: extractLevel(title, school),
        title,
        deadline,
        url: `${BASE_URL}/main/bbs/list.do?key=${KEY}`,
        source: 'gwe.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) {
      emptyPages++;
      if (emptyPages >= 2) break;
    } else {
      emptyPages = 0;
    }
    page++;
  }

  console.log(`[강원] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlGangwon;
