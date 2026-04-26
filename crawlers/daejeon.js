const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://www.dje.go.kr';
const BOARD_ID = '54';
const M = '030202';



async function crawlDaejeon() {
  const jobs = [];
  const seen = new Set();
  let page = 1;

  while (page <= 20) {
    const url = `${BASE_URL}/boardCnts/list.do?boardID=${BOARD_ID}&m=${M}&s=dje&page=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[대전] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const links = $(`a[onclick*="goView('${BOARD_ID}',"]`).filter((_, el) => {
      return $(el).closest('table').length > 0;
    });
    if (links.length === 0) break;

    let hasNew = false;
    links.each((_, a) => {
      const title = ($(a).attr('title') || $(a).text()).replace(/\s+/g, ' ').trim();
      // 기간제교원 공고만 필터링
      if (!title.includes('기간제') && !title.includes('계약제')) return;

      const onclick = $(a).attr('onclick') || '';
      const seqMatch = onclick.match(/goView\('[^']+',\s*'(\d+)'/);
      if (!seqMatch) return;
      const boardSeq = seqMatch[1];
      if (seen.has(boardSeq)) return;
      seen.add(boardSeq);

      // 마감일: td[5] 포맷 "2026/04/27~2026/05/04"
      const tr = $(a).closest('tr');
      const tds = tr.find('td');
      const periodText = tds.eq(5).text().trim();
      const parts = periodText.split('~');
      const deadline = parseDate(parts[1] || parts[0] || '');

      if (isExpired(deadline)) return;

      hasNew = true;
      jobs.push({
        id: `daejeon_${boardSeq}`,
        sido: '대전',
        school: '',
        subject: extractSubject(title),
        level: extractLevel(title),
        title,
        deadline,
        url: `${BASE_URL}/boardCnts/view.do?boardID=${BOARD_ID}&boardSeq=${boardSeq}&lev=0&searchType=null&statusYN=W&page=${page}&s=dje&m=${M}&opType=N`,
        source: 'dje.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) break;
    page++;
  }

  console.log(`[대전] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlDaejeon;
