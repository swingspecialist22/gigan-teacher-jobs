const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://www.goe.go.kr';
const LIST_URL = `${BASE_URL}/recruit/ad/func/pb/hnfpPbancList.do`;

async function crawlGyeonggi() {
  const jobs = [];
  const seen = new Set();
  let page = 1;
  let emptyPages = 0;

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

      // 실제 HTML 구조:
      // div.cont_txt > div.cont_top > span[학교명], span[전화], span[등록일], span[조회]
      // div.cont_txt > p.cont_tit > span.krds-badge(배지) + 제목텍스트
      // div.cont_txt > div.cont_btm > p > em.btm_tit(접수기간) + 날짜텍스트
      const school = $(a).find('div.cont_top > span').first().text().trim();

      const titleEl = $(a).find('p.cont_tit').clone();
      titleEl.find('span.krds-badge').remove();
      const title = titleEl.text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      let deadline = '';
      $(a).find('em.btm_tit').each((_, em) => {
        if ($(em).text().includes('접수기간')) {
          const periodText = $(em).parent().text().replace('접수기간', '').trim();
          const parts = periodText.split('~');
          deadline = parseDate((parts[1] || '').trim()) || '';
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

    if (!hasNew) {
      emptyPages++;
      if (emptyPages >= 2) break;
    } else {
      emptyPages = 0;
    }
    page++;
  }

  console.log(`[경기] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlGyeonggi;
