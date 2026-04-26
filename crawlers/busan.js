const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://www.pen.go.kr';
const LIST_URL = `${BASE_URL}/main/na/ntt/selectNttList.do?mi=30367&bbsId=2364`;

async function crawlBusan() {
  const jobs = [];
  const seen = new Set();
  let page = 1;

  while (page <= 20) {
    const url = `${LIST_URL}&currPage=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[부산] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const rows = $('table tbody tr:has(td)');

    if (rows.length === 0) break;

    let hasNew = false;
    rows.each((_, row) => {
      const tds = $(row).find('td');
      if (tds.length < 3) return;

      // 제목: data-id로 실제 URL 구성
      const titleEl = $(row).find('a.nttInfoBtn');
      const dataId = titleEl.attr('data-id');
      if (!dataId) return;
      if (seen.has(dataId)) return;
      seen.add(dataId);

      // 이미지 alt 텍스트 제거 후 제목 추출
      titleEl.find('img').remove();
      const title = titleEl.text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      // 접수기간
      const periodTd = $(row).find('td:has(em.mTit)').filter((_, el) =>
        $(el).find('em.mTit').text().includes('접수기간')
      );
      const periodText = periodTd.text().replace('접수기간', '').trim();
      const dates = periodText.split('~');
      const deadline = parseDate(dates[1] || '');

      if (isExpired(deadline)) return;

      // 작성자 (학교명)
      const writerTd = $(row).find('td:has(em.mTit)').filter((_, el) =>
        $(el).find('em.mTit').text().includes('작성자')
      );
      const school = writerTd.text().replace('작성자', '').trim();

      const detailUrl = `${BASE_URL}/main/na/ntt/selectNttInfo.do?mi=30367&bbsId=2364&nttSn=${dataId}`;

      hasNew = true;
      jobs.push({
        id: `busan_${dataId}`,
        sido: '부산',
        school,
        subject: extractSubject(title),
        level: extractLevel(title, school),
        title,
        deadline,
        url: detailUrl,
        source: 'pen.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) break;
    page++;
  }

  console.log(`[부산] ${jobs.length}건 수집`);
  return jobs;
}


module.exports = crawlBusan;
