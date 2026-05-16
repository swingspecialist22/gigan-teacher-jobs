const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://www.jbe.go.kr';
const LIST_URL = `${BASE_URL}/pool/board/list.jbe?boardId=BBS_0000130&menuCd=DOM_000001601002000000&paging=ok&searchOperation=AND&listRow=30&listCel=1`;

// 명백한 비교사직만 제외 (나머지는 교원 관련 공고로 수집)
const SUBJECT_EXCLUDE = /교육공무직|조리|청소|봉사|안전지킴이|통학버스|돌봄전담|사무직원|시설관리|경비원|미화원|방과후.*강사|방과후.*전일제|개인위탁|태권도|행정대체|교무실무사|배식|산학겸임|늘봄.*강사/;

function levelFromCategory(cat) {
  if (/초등/.test(cat)) return '초등';
  if (/중학/.test(cat)) return '중등';
  if (/고등/.test(cat)) return '고등';
  if (/유치/.test(cat)) return '유치';
  if (/특수/.test(cat)) return '특수';
  return '';
}

async function crawlJeonbuk() {
  const jobs = [];
  const seen = new Set();
  let page = 1;

  while (page <= 20) {
    const url = `${LIST_URL}&startPage=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[전북] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const rows = $('table tbody tr').filter((_, tr) =>
      $(tr).find('td[data-cell-header^="학교"]').length > 0
    );
    if (rows.length === 0) break;

    // 페이지 내 모든 row의 마감일이 지났는지 추적 (SUBJECT_INCLUDE 여부와 무관)
    let pageAllExpired = true;

    rows.each((_, row) => {
      const periodText = $(row).find('td[data-cell-header^="접수기간"]').text().trim();
      const parts = periodText.split('~');
      const deadline = parseDate((parts[1] || parts[0] || '').trim()) || '';
      if (!isExpired(deadline)) pageAllExpired = false;

      const subject = $(row).find('td[data-cell-header^="과목"]').text().trim();
      if (SUBJECT_EXCLUDE.test(subject)) return;

      const schoolEl = $(row).find('td[data-cell-header^="학교"] a');
      const school = schoolEl.attr('title') || schoolEl.text().trim();
      const href = schoolEl.attr('href') || '';
      const dataSidMatch = href.match(/dataSid=(\d+)/);
      if (!dataSidMatch) return;
      const dataSid = dataSidMatch[1];
      if (seen.has(dataSid)) return;
      seen.add(dataSid);

      const rawLevel = $(row).find('td[data-cell-header^="구분"]').text().trim();
      const level = levelFromCategory(rawLevel) || extractLevel(subject, school);

      if (isExpired(deadline)) return;

      jobs.push({
        id: `jeonbuk_${dataSid}`,
        sido: '전북',
        school,
        subject: extractSubject(subject) || subject,
        level,
        title: `${school} ${subject}`,
        deadline,
        url: `${BASE_URL}${href.startsWith('/') ? href : '/' + href}`,
        source: 'jbe.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    // 최신순 정렬 기준: 페이지 내 모든 공고가 마감됐으면 이후 페이지도 만료
    if (pageAllExpired) break;
    page++;
  }

  console.log(`[전북] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlJeonbuk;
