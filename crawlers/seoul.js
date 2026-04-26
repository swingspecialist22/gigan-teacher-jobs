const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://work.sen.go.kr';
const LIST_URL = `${BASE_URL}/work/search/recInfo/BD_selectSrchRecInfo.do`;


async function crawlSeoul() {
  const jobs = [];
  const seen = new Set();
  let page = 1;

  while (page <= 20) {
    const params = new URLSearchParams({
      q_recDtlScCd: '1040',
      q_rowPerPage: '20',
      q_currPage: String(page),
    });
    const url = `${LIST_URL}?${params.toString()}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[서울] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const items = $('#srchDataDiv li.flex_cont');
    if (items.length === 0) break;

    let hasNew = false;
    items.each((_, li) => {
      const linkEl = $(li).find('a[href*="BD_selectRecDetail.do"]');
      const href = linkEl.attr('href') || '';
      const snMatch = href.match(/q_rcrtSn=(\d+)/);
      if (!snMatch) return;
      const rcrtSn = snMatch[1];
      if (seen.has(rcrtSn)) return;
      seen.add(rcrtSn);

      const title = linkEl.text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      // 학교명: span.s_title 앞부분
      const sTitle = $(li).find('span.s_title').text();
      const school = sTitle.split('|')[0].trim();

      // 접수기간
      let deadline = '';
      $(li).find('p.tag_title').each((_, p) => {
        if ($(p).text().includes('접수기간')) {
          const periodText = $(p).next('span').text();
          const parts = periodText.split('~');
          deadline = parseDate(parts[1] || '');
        }
      });

      if (isExpired(deadline)) return;

      hasNew = true;
      jobs.push({
        id: `seoul_${rcrtSn}`,
        sido: '서울',
        school,
        subject: extractSubject(title),
        level: extractLevel(title, school),
        title,
        deadline,
        url: `${BASE_URL}/work/search/recInfo/BD_selectRecDetail.do?q_rcrtSn=${rcrtSn}`,
        source: 'work.sen.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) break;
    page++;
  }

  console.log(`[서울] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlSeoul;
