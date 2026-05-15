const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://www.goe.go.kr';
const LIST_URL = `${BASE_URL}/recruit/ad/func/pb/hnfpPbancList.do`;

async function crawlGyeonggi() {
  const jobs = [];
  const seen = new Set();
  let page = 1;

  while (page <= 50) {
    const params = new URLSearchParams({
      q_pbanSe: '2',  // 기간제교원
      q_currPage: String(page),
    });
    const url = `${LIST_URL}?${params.toString()}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[경기] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    // 실제 HTML: <a href="javascript:goView('12345');">
    const items = $('a[href*="goView"]');

    if (items.length === 0) break;

    let hasNew = false;
    items.each((_, a) => {
      const href = $(a).attr('href') || '';
      const idMatch = href.match(/goView\('?(\d+)'?\)/);
      if (!idMatch) return;
      const pbancSn = idMatch[1];
      if (seen.has(pbancSn)) return;
      seen.add(pbancSn);

      // 실제 구조: class 없는 div 배열
      // div[0]: 학교명 + 전화번호 + 등록일 + 조회수
      // div[1]: [마감임박] 공고제목
      // div[n]: 접수기간 포함 div
      const divs = $(a).find('div');

      const school = divs.eq(0).text()
        .replace(/\s*\d{2,4}-\d{3,4}-\d{4}.*$/, '').trim();

      const title = divs.eq(1).text()
        .replace(/^(마감임박|마감)\s*/u, '').replace(/\s+/g, ' ').trim();
      if (!title) return;

      let deadline = '';
      divs.each((_, div) => {
        const text = $(div).text();
        if (text.includes('접수기간')) {
          const clean = text.replace(/접수기간\s*/g, '').trim();
          const parts = clean.split('~');
          deadline = parseDate((parts[1] || '').trim());
        }
      });

      if (isExpired(deadline)) return;

      hasNew = true;
      jobs.push({
        id: `gyeonggi_${pbancSn}`,
        sido: '경기',
        school,
        subject: extractSubject(title),
        level: extractLevel(title, school),
        title,
        deadline,
        url: `${BASE_URL}/recruit/ad/func/pb/hnfpPbancInfoView.do?pbancSn=${pbancSn}`,
        source: 'goe.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) break;
    page++;
  }

  console.log(`[경기] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlGyeonggi;
