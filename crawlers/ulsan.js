const cheerio = require('cheerio');
const { fetchHtml, parseDate, isExpired, extractSubject, extractLevel } = require('./utils');

const BASE_URL = 'https://use.go.kr';

// Source 1: 기간제교사 전용 구조화 인력풀
async function crawlJobPost(jobs, seen) {
  const LIST_URL = `${BASE_URL}/job/user/jobpost/BD_selectJobPostList.do`;
  let page = 1;

  while (page <= 20) {
    const url = `${LIST_URL}?q_jobOcptNm=%EA%B8%B0%EA%B0%84%EC%A0%9C%EA%B5%90%EC%82%AC&q_rowPerPage=10&q_currPage=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[울산/jobpost] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const links = $('a[href*="BD_selectJobPost.do?q_jobPostSn="]');
    if (links.length === 0) break;

    let hasNew = false;
    links.each((_, a) => {
      const href = $(a).attr('href') || '';
      const snMatch = href.match(/q_jobPostSn=(\d+)/);
      if (!snMatch) return;
      const sn = snMatch[1];
      const id = `ulsan_job_${sn}`;
      if (seen.has(id)) return;
      seen.add(id);

      const title = $(a).text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      const row = $(a).closest('tr');
      const deadline = parseDate(row.find('td[data-name="마감일"]').text().trim()) || '';
      if (isExpired(deadline)) return;

      // 학교명은 제목에서 추출 (목록의 학교명 컬럼이 비어있음)
      const school = row.find('td[data-name="학교명"]').text().trim();

      hasNew = true;
      jobs.push({
        id,
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

    if (!hasNew) break;
    page++;
  }
}

// Source 2: 울산교육청 채용공고 BBS (q_bbsSn=2249)
// 기간제교원·시간강사 카테고리만 수집
const BBS_INCLUDE = /기간제교원|기간제교사|계약제교원|시간강사/;

async function crawlBbs(jobs, seen) {
  const LIST_URL = `${BASE_URL}/job/user/bbs/BD_selectBbsList.do`;
  let page = 1;

  while (page <= 20) {
    const url = `${LIST_URL}?q_bbsSn=2249&pageIndex=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.error(`[울산/bbs] 페이지 ${page} 실패:`, e.message);
      break;
    }

    const $ = cheerio.load(html);
    const rows = $('table tbody tr').filter((_, tr) => $(tr).find('td[data-name="구분"]').length > 0);
    if (rows.length === 0) break;

    let hasNew = false;
    rows.each((_, tr) => {
      const category = $(tr).find('td[data-name="구분"]').text().trim();
      if (!BBS_INCLUDE.test(category)) return;

      const linkEl = $(tr).find('a[href*="BD_selectBbs.do"]').first();
      const href = linkEl.attr('href') || '';
      const docMatch = href.match(/q_bbsDocNo=([^&"]+)/);
      if (!docMatch) return;
      const docNo = docMatch[1];
      const id = `ulsan_bbs_${docNo}`;
      if (seen.has(id)) return;
      seen.add(id);

      const title = linkEl.text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      const school = $(tr).find('td[data-name="학교명"]').text().trim();
      const periodText = $(tr).find('td[data-name="접수기간"]').text().trim();
      const parts = periodText.split(/[~–－-]/);
      const deadline = parseDate((parts[1] || parts[0] || '').trim()) || '';
      if (isExpired(deadline)) return;

      hasNew = true;
      jobs.push({
        id,
        sido: '울산',
        school,
        subject: extractSubject(title),
        level: extractLevel(title, school),
        title,
        deadline,
        url: `${BASE_URL}${href.startsWith('/') ? href : '/job/user/bbs/' + href}`,
        source: 'use.go.kr',
        crawled_at: new Date().toISOString(),
      });
    });

    if (!hasNew) break;
    page++;
  }
}

async function crawlUlsan() {
  const jobs = [];
  const seen = new Set();
  await Promise.all([
    crawlJobPost(jobs, seen),
    crawlBbs(jobs, seen),
  ]);
  console.log(`[울산] ${jobs.length}건 수집`);
  return jobs;
}

module.exports = crawlUlsan;
