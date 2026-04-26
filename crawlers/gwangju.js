const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://www.gen.go.kr';
// sCat=11: 기간제교사구인(유·초등), sCat=12: 특수학교강사구인
const LIST_URL = `${BASE_URL}/xboard/board.php`;

async function crawlGwangju() {
  const jobs = [];
  const seen = new Set();
  // sCat=11: 기간제교사(유·초등)
  for (const sCat of ['11', '12']) {
    let page = 1;
    while (page <= 20) {
      const params = new URLSearchParams({
        tbnum: '32',
        mode: 'list',
        sCat,
        page: String(page),
      });
      const url = `${LIST_URL}?${params.toString()}`;
      let html;
      try {
        html = await fetchHtml(url);
      } catch (e) {
        console.error(`[광주] sCat=${sCat} 페이지 ${page} 실패:`, e.message);
        break;
      }

      const $ = cheerio.load(html);
      const rows = $('td.left.subject a');
      if (rows.length === 0) break;

      let hasNew = false;
      rows.each((_, a) => {
        const href = $(a).attr('href') || '';
        const numMatch = href.match(/number=(\d+)/);
        if (!numMatch) return;
        const number = numMatch[1];
        if (seen.has(number)) return;
        seen.add(number);

        // 제목 (img 제거)
        $(a).find('img').remove();
        const title = $(a).text().replace(/\s+/g, ' ').trim();
        if (!title) return;

        // 실제 td 순서: [번호, 학교명, 제목(link), 과목, 공고일, 채용예정기간, 조회수, 상태]
        const tr = $(a).closest('tr');
        const tds = tr.find('td');
        const school = tds.eq(1).text().trim();
        const subject = tds.eq(3).text().trim();
        // td[7]=상태: "채용중" 인 것만 수집 (마감은 제외)
        const status = tds.eq(7).text().trim();
        if (!status.includes('채용중')) return;

        // 목록에는 접수기간이 없음 — 마감일 비워둠
        const deadline = '';

        hasNew = true;
        jobs.push({
          id: `gwangju_${number}`,
          sido: '광주',
          school,
          subject,
          level: extractLevel(title, school),
          title,
          deadline,
          url: `${BASE_URL}/xboard/board.php?tbnum=32&mode=view&number=${number}&sCat=${sCat}`,
          source: 'gen.go.kr',
          crawled_at: new Date().toISOString(),
        });
      });

      if (!hasNew) break;
      page++;
    }
  }

  console.log(`[광주] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlGwangju;
