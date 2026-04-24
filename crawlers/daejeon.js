const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired } = require('./utils');

const BASE_URL = 'https://www.dje.go.kr';
const BOARD_ID = '54';
const M = '030202';

function extractLevel(title) {
  if (title.includes('초등') || title.includes('초교')) return '초등';
  if (title.includes('중학') || title.includes('중교')) return '중등';
  if (title.includes('고등') || title.includes('고교')) return '고등';
  if (title.includes('유치')) return '유치';
  if (title.includes('특수')) return '특수';
  return '';
}

function extractSubject(title) {
  const match = title.match(/[（(（]([^)））]{1,15})[)））]/);
  return match ? match[1] : '';
}

async function crawlDaejeon() {
  const jobs = [];
  let page = 1;

  while (true) {
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

    const nextLink = $(`a[href*="page=${page + 1}"][href*="boardID=${BOARD_ID}"]`);
    if (nextLink.length === 0) break;
    page++;
  }

  console.log(`[대전] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlDaejeon;
