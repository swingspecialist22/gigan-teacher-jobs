/**
 * 표준 na/ntt BBS 시스템 공통 크롤러
 * 부산, 인천, 전남, 경북, 충북 등에서 동일하게 사용
 */
const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');


/**
 * @param {object} config
 * @param {string} config.sido - 시도명 (예: '인천')
 * @param {string} config.baseUrl - 도메인 (예: 'https://www.ice.go.kr')
 * @param {string} config.path - BBS 경로 (예: '/ice/na/ntt')
 * @param {string} config.mi - 메뉴ID
 * @param {string} config.bbsId - 게시판ID
 * @param {string} config.source - 출처 도메인 (예: 'ice.go.kr')
 */
async function crawlNttBbs(config) {
  const { sido, baseUrl, path, mi, bbsId, source } = config;
  const listUrl = `${baseUrl}${path}/selectNttList.do?mi=${mi}&bbsId=${bbsId}`;
  const jobs = [];
  let page = 1;

  while (true) {
    const url = `${listUrl}&currPage=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[${sido}] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const rows = $('table tbody tr:has(td)');
    if (rows.length === 0) break;

    let hasNew = false;
    let hasRows = false;
    rows.each((_, row) => {
      const titleEl = $(row).find('a.nttInfoBtn');
      const dataId = titleEl.attr('data-id');
      if (!dataId) return;
      hasRows = true;

      titleEl.find('img, span').remove();
      const title = titleEl.text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      const tds = $(row).find('td');

      // 마감일 추출
      let deadline = '';
      if (config.colDeadline !== undefined) {
        deadline = parseDate(tds.eq(config.colDeadline).text().trim()) || '';
      } else {
        $(row).find('td[data-table="write"]').each((_, td) => {
          const d = parseDate($(td).text().trim());
          if (d) deadline = d;
        });
        if (!deadline) {
          const periodTd = $(row).find('td').filter((_, td) =>
            $(td).find('em.mTit').text().includes('접수기간')
          );
          if (periodTd.length) {
            const parts = periodTd.text().replace('접수기간', '').trim().split('~');
            deadline = parseDate(parts[1] || parts[0] || '') || '';
          }
        }
      }

      if (isExpired(deadline)) return;

      // 학교명 추출
      let school = '';
      if (config.colSchool !== undefined) {
        school = tds.eq(config.colSchool).text().replace(/\s+/g, ' ').trim();
      } else {
        $(row).find('td[data-table="write"]').each((_, td) => {
          if (school) return;
          const text = $(td).text().replace(/\s+/g, ' ').trim();
          if (text && !parseDate(text) && text.length > 1 && !text.includes('모집')) {
            school = text;
          }
        });
        if (!school) {
          const writerTd = $(row).find('td').filter((_, td) =>
            $(td).find('em.mTit').text().includes('작성자')
          );
          school = writerTd.text().replace('작성자', '').trim();
        }
      }

      // 학교급 직접 지정 컬럼이 있으면 우선 사용
      const levelFromCol = config.colLevel !== undefined
        ? tds.eq(config.colLevel).text().trim()
        : '';

      hasNew = true;
      jobs.push({
        id: `${source.replace('.', '_')}_${dataId}`,
        sido,
        school,
        subject: extractSubject(title),
        level: levelFromCol || extractLevel(title),
        title,
        deadline,
        url: `${baseUrl}${path}/selectNttInfo.do?mi=${mi}&bbsId=${bbsId}&nttSn=${dataId}`,
        source,
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasRows || !hasNew) break;
    page++;
  }

  console.log(`[${sido}] ${jobs.length}건 수집`);
  return jobs;
}

// 각 교육청 설정
const NTT_SITES = [
  {
    sido: '인천',
    baseUrl: 'https://www.ice.go.kr',
    path: '/ice/na/ntt',
    mi: '10997',
    bbsId: '1981',
    source: 'ice.go.kr',
  },
  {
    sido: '전남',
    baseUrl: 'https://www.jne.go.kr',
    path: '/main/na/ntt',
    mi: '265',
    bbsId: '117',
    source: 'jne.go.kr',
  },
  {
    sido: '경북',
    baseUrl: 'https://www.gbe.kr',
    path: '/main/na/ntt',
    mi: '3626',
    bbsId: '1887',
    source: 'gbe.kr',
    colSchool: 4,
    colDeadline: 6,
    colLevel: 3,
  },
  {
    sido: '충북',
    baseUrl: 'https://www.cbe.go.kr',
    path: '/mpool/na/ntt',
    mi: '12127',
    bbsId: '1091',
    source: 'cbe.go.kr',
  },
  {
    sido: '세종',
    baseUrl: 'https://www.sje.go.kr',
    path: '/sje/na/ntt',
    mi: '52132',
    bbsId: '108',
    source: 'sje.go.kr',
  },
];

async function crawlAllNttSites() {
  const results = await Promise.allSettled(
    NTT_SITES.map(config => crawlNttBbs(config))
  );
  const jobs = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') jobs.push(...r.value);
    else console.error(`[${NTT_SITES[i].sido}] 실패:`, r.reason.message);
  });
  return jobs;
}

module.exports = { crawlAllNttSites };
