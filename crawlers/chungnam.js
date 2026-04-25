const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired } = require('./utils');

const BASE_URL = 'https://www.cne.go.kr';

// 유치원/초등/중등 기간제 게시판 각각
const BOARDS = [
  { boardID: '11005', m: '020201', level: '유치' },
  { boardID: '642',   m: '020201', level: '초등' },
  { boardID: '644',   m: '020201', level: '중등' },
];

async function crawlBoard(boardID, m, level) {
  const jobs = [];
  let page = 1;

  while (true) {
    const url = `${BASE_URL}/boardCnts/list.do?boardID=${boardID}&m=${m}&s=cne&page=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[충남 ${level}] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    // 공고 행: onclick에 goView 포함된 a 태그
    const links = $(`a[onclick*="goView('${boardID}'"]`).filter((_, el) => {
      return $(el).closest('table').length > 0;
    });
    if (links.length === 0) break;

    let hasNew = false;
    links.each((_, a) => {
      const onclick = $(a).attr('onclick') || '';
      const seqMatch = onclick.match(/goView\('[^']+',\s*'(\d+)'/);
      if (!seqMatch) return;
      const boardSeq = seqMatch[1];

      const school = $(a).text().replace(/\s+/g, ' ').trim();
      if (!school) return;

      const tr = $(a).closest('tr');
      const tds = tr.find('td');
      // 컬럼: 번호, 과목, 지역, 학교명(link), 작성일, 마감일, 조회수
      const subject = tds.eq(1).text().trim();
      const deadlineText = tds.eq(5).text().trim();
      const deadline = parseDate(deadlineText);

      if (isExpired(deadline)) return;

      hasNew = true;
      jobs.push({
        id: `chungnam_${boardSeq}`,
        sido: '충남',
        school,
        subject,
        level,
        title: `${school} 기간제교사 채용`,
        deadline,
        url: `${BASE_URL}/boardCnts/view.do?boardID=${boardID}&boardSeq=${boardSeq}&lev=0&searchType=null&statusYN=W&page=${page}&s=cne&m=${m}&opType=N`,
        source: 'cne.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) break;

    const nextLink = $(`a[href*="page=${page + 1}"]`).filter((_, el) => {
      return $(el).attr('href').includes(`boardID=${boardID}`);
    });
    if (nextLink.length === 0) break;
    page++;
  }

  return jobs;
}

async function crawlChungnam() {
  const results = await Promise.allSettled(
    BOARDS.map(b => crawlBoard(b.boardID, b.m, b.level))
  );
  const jobs = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') jobs.push(...r.value);
    else console.error(`[충남 ${BOARDS[i].level}] 실패:`, r.reason.message);
  });
  console.log(`[충남] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlChungnam;
