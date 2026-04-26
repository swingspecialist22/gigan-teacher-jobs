const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { parseDate, isExpired, isOldExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'http://www.cne.go.kr';
const LIST_URL = `${BASE_URL}/apply/list.do?s=cne&m=032101`;

const LEVEL_MAP = { '초': '초등', '중': '중등', '고': '고등', '유': '유치', '특': '특수' };

async function crawlChungnam() {
  const jobs = [];
  const seen = new Set();
  let page = 1;

  while (page <= 20) {
    let html;
    try {
      const res = await fetch(LIST_URL, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `nowPage=${page}&rcpt_bgng_ymd=&rcpt_endd_ymd=&empmn_qualf_course=`,
      });
      html = await res.text();
    } catch (e) {
      console.error(`[충남] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const rows = $('tr').filter((_, el) => $(el).find('td').length === 11);
    if (rows.length === 0) break;

    let hasNew = false;
    let shouldStop = false;

    rows.each((_, row) => {
      const tds = $(row).find('td');
      const status = tds.eq(6).text().trim();
      // 마감 상태는 건너뜀
      if (status === '마감') return;

      const onclick = $(row).find('[onclick*="listAction"]').attr('onclick') || '';
      const seqMatch = onclick.match(/listAction\('(\d+)'\)/);
      if (!seqMatch) return;
      const seq = seqMatch[1];
      if (seen.has(seq)) return;
      seen.add(seq);

      const school = tds.eq(3).text().trim();
      const subject = tds.eq(5).text().trim();
      const rawLevel = tds.eq(2).text().trim();
      const level = LEVEL_MAP[rawLevel] || extractLevel('', school);

      // 접수기간 끝 날짜 파싱: "2026-04-27 09:00 ~ 2026-04-29 10:00"
      const periodText = tds.eq(7).text().trim();
      const parts = periodText.split('~');
      const deadline = parseDate((parts[1] || '').trim());

      if (isOldExpired(deadline)) { shouldStop = true; return; }
      if (isExpired(deadline)) return;

      const title = `${school} ${subject} 기간제교사 채용`;

      hasNew = true;
      jobs.push({
        id: `chungnam_${seq}`,
        sido: '충남',
        school,
        subject: extractSubject(subject) || subject,
        level,
        title,
        deadline,
        url: `${BASE_URL}/apply/select.do?s=cne&m=032101`,
        source: 'cne.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew || shouldStop) break;
    page++;
  }

  console.log(`[충남] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlChungnam;
