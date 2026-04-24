const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired } = require('./utils');

const BASE_URL = 'https://www.gne.go.kr';
const LIST_URL = `${BASE_URL}/works/user/recruitment/BD_recruitmentList.do`;

async function crawlGyeongnam() {
  const jobs = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      q_searchStatus: '1001',
      q_rowPerPage: '30',
      q_currPage: String(page),
    });
    const url = `${LIST_URL}?${params.toString()}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[경남] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const rows = $('table tbody tr');
    if (rows.length === 0) break;

    let hasNew = false;
    rows.each((_, row) => {
      // 카테고리에 '기간제교원' 또는 '기간제교사' 포함된 것만
      const cate = $(row).find('span.cate').first().text().trim();
      if (!cate.includes('기간제교원') && !cate.includes('기간제교사') && !cate.includes('계약제교원')) return;

      // onclick에서 ID 추출
      const titleEl = $(row).find('a[onclick*="openDetail"]');
      const onclick = titleEl.attr('onclick') || '';
      const idMatch = onclick.match(/openDetail\('?(\d+)'?\)/);
      if (!idMatch) return;
      const regSn = idMatch[1];

      const title = titleEl.attr('title') || titleEl.text().trim();

      // 접수기간
      const periodTd = $(row).find('td').filter((_, td) =>
        $(td).find('span.cate').text().includes('접수기간')
      );
      const periodText = periodTd.find('span:not(.cate)').text().trim();
      const dates = periodText.split('~');
      const deadline = parseDate(dates[1] || '');
      if (isExpired(deadline)) return;

      // 모집기관
      const orgTd = $(row).find('td').filter((_, td) =>
        $(td).find('span.cate').text().includes('모집기관')
      );
      const school = orgTd.find('span:not(.cate)').text().trim();

      // 지역 추출 (카테고리 앞부분)
      const region = cate.split('｜')[0].trim();

      hasNew = true;
      jobs.push({
        id: `gyeongnam_${regSn}`,
        sido: '경남',
        school,
        subject: '',
        level: extractLevel(title),
        title,
        deadline,
        region,
        url: `${BASE_URL}/works/user/recruitment/BD_recruitmentDetail.do?regSn=${regSn}`,
        source: 'gne.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) break;

    // 다음 페이지 확인
    const nextLink = $(`a[onclick*="opMovePage(${page + 1})"], a[onclick*="fn_link_page(${page + 1})"]`);
    if (nextLink.length === 0) break;
    page++;
  }

  console.log(`[경남] ${jobs.length}건 수집`);
  return jobs;
}

function extractLevel(title) {
  if (title.includes('초등') || title.includes('초교')) return '초등';
  if (title.includes('중학') || title.includes('중교')) return '중등';
  if (title.includes('고등') || title.includes('고교')) return '고등';
  if (title.includes('유치')) return '유치';
  if (title.includes('특수')) return '특수';
  return '';
}

module.exports = crawlGyeongnam;
