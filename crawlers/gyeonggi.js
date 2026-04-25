const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://www.goe.go.kr';
const LIST_URL = `${BASE_URL}/recruit/ad/func/pb/hnfpPbancList.do`;

async function crawlGyeonggi() {
  const jobs = [];
  let page = 1;

  while (true) {
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
    // 각 공고: li > a[href*="goView"]
    const items = $('a[href*="goView"]').filter((_, el) => {
      const onclick = $(el).attr('href') || '';
      return onclick.includes('goView(');
    });

    if (items.length === 0) break;

    let hasNew = false;
    items.each((_, a) => {
      const href = $(a).attr('href') || '';
      const idMatch = href.match(/goView\('?(\d+)'?\)/);
      if (!idMatch) return;
      const pbancSn = idMatch[1];

      // 학교명
      const school = $(a).find('div.cont_top > span').first().text().trim();

      // 공고 제목
      const title = $(a).find('p.cont_tit').text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      // 접수기간
      let deadline = '';
      $(a).find('em.btm_tit').each((_, em) => {
        if ($(em).text().includes('접수기간')) {
          const periodText = $(em).parent().text().replace('접수기간', '').trim();
          const parts = periodText.split('~');
          deadline = parseDate(parts[1] || '');
        }
      });

      if (isExpired(deadline)) return;

      hasNew = true;
      jobs.push({
        id: `gyeonggi_${pbancSn}`,
        sido: '경기',
        school,
        subject: extractSubject(title),
        level: extractLevel(title),
        title,
        deadline,
        url: `${BASE_URL}/recruit/ad/func/pb/hnfpPbancInfoView.do?pbancSn=${pbancSn}`,
        source: 'goe.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) break;

    // 다음 페이지 확인
    const nextLink = $(`a[onclick*="currPage=${page + 1}"], a[href*="q_currPage=${page + 1}"]`);
    if (nextLink.length === 0) break;
    page++;
  }

  console.log(`[경기] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlGyeonggi;
