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
    // 실제 HTML: <a onclick="javascript:goView('12345');">
    const items = $('a[onclick*="goView("]');

    if (items.length === 0) break;

    let hasNew = false;
    items.each((_, a) => {
      const onclick = $(a).attr('onclick') || '';
      const idMatch = onclick.match(/goView\('?(\d+)'?\)/);
      if (!idMatch) return;
      const pbancSn = idMatch[1];
      if (seen.has(pbancSn)) return;
      seen.add(pbancSn);

      // 학교명 (전화번호 포함될 수 있으므로 제거)
      const school = $(a).find('div.school_name').text()
        .replace(/\s*[\d]{2,4}-[\d]{3,4}-[\d]{4}/, '').trim();

      // 공고 제목
      const title = ($(a).find('div.title').text() || $(a).find('p.cont_tit').text())
        .replace(/\s+/g, ' ').trim();
      if (!title) return;

      // 접수기간: <span class="period">접수기간 2026/05/15 ~ 2026/05/19</span>
      let deadline = '';
      $(a).find('span.period, em.btm_tit').each((_, el) => {
        const text = $(el).text();
        if (text.includes('접수기간')) {
          const periodText = text.replace('접수기간', '').trim();
          const parts = periodText.split('~');
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
