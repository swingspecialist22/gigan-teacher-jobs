const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, isOldExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://use.go.kr';
const LIST_URL = `${BASE_URL}/job/user/jobpost/BD_selectJobPostList.do`;

async function crawlUlsan() {
  const jobs = [];
  const seen = new Set();
  let page = 1;

  while (page <= 20) {
    const url = `${LIST_URL}?q_currPage=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[울산] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const rows = $('a[href*="BD_selectJobPost.do"]').map((_, a) => $(a).closest('tr')).toArray();
    if (rows.length === 0) break;

    let hasNew = false;
    let shouldStop = false;

    rows.forEach(row => {
      const tds = $(row).find('td');
      const linkEl = $(row).find('a[href*="BD_selectJobPost.do"]').first();
      const href = linkEl.attr('href') || '';
      const snMatch = href.match(/q_jobPostSn=(\d+)/);
      if (!snMatch) return;
      const sn = snMatch[1];
      if (seen.has(sn)) return;
      seen.add(sn);

      const title = linkEl.text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      const school = tds.eq(1).text().trim();
      const deadline = parseDate(tds.eq(6).text().trim());

      if (isOldExpired(deadline)) { shouldStop = true; return; }
      if (isExpired(deadline)) return;

      hasNew = true;
      jobs.push({
        id: `ulsan_${sn}`,
        sido: '울산',
        school,
        subject: extractSubject(title),
        level: extractLevel(title, school),
        title,
        deadline,
        url: `${BASE_URL}/job/user/jobpost/BD_selectJobPost.do?q_jobPostSn=${sn}`,
        source: 'use.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew || shouldStop) break;
    page++;
  }

  console.log(`[울산] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlUlsan;
