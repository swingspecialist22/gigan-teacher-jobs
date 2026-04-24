const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired } = require('./utils');

const BASE_URL = 'https://work.sen.go.kr';
const LIST_URL = `${BASE_URL}/work/search/recInfo/BD_selectSrchRecInfo.do`;

function extractLevel(title) {
  if (title.includes('초등') || title.includes('초교')) return '초등';
  if (title.includes('중학') || title.includes('중교')) return '중등';
  if (title.includes('고등') || title.includes('고교')) return '고등';
  if (title.includes('유치')) return '유치';
  if (title.includes('특수')) return '특수';
  return '';
}

function extractSubject(title) {
  const match = title.match(/[（(]([^)）]{1,15})[)）]/);
  return match ? match[1] : '';
}

async function crawlSeoul() {
  const jobs = [];
  let page = 1;

  while (true) {
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
        level: extractLevel(title),
        title,
        deadline,
        url: `${BASE_URL}/work/search/recInfo/BD_selectRecDetail.do?q_rcrtSn=${rcrtSn}`,
        source: 'work.sen.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) break;

    const nextLink = $(`a[href*="q_currPage=${page + 1}"], a[onclick*="currPage=${page + 1}"]`);
    if (nextLink.length === 0) break;
    page++;
  }

  console.log(`[서울] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlSeoul;
