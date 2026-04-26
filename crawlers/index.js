const fs = require('fs');
// 일부 교육청 사이트 자체 서명 인증서 허용
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const path = require('path');
const crawlBusan = require('./busan');
const crawlJeonbuk = require('./jeonbuk');
const crawlGyeongnam = require('./gyeongnam');
const crawlGangwon = require('./gangwon');
const crawlSeoul = require('./seoul');
const crawlGyeonggi = require('./gyeonggi');
const crawlGwangju = require('./gwangju');
const crawlChungnam = require('./chungnam');
const crawlDaejeon = require('./daejeon');
const { crawlAllNttSites } = require('./ntt-bbs');
const { isRelevantJob } = require('./utils');

async function main() {
  console.log('크롤링 시작...\n');

  const results = await Promise.allSettled([
    crawlBusan(),
    crawlJeonbuk(),
    crawlGyeongnam(),
    crawlGangwon(),
    crawlSeoul(),
    crawlGyeonggi(),
    crawlGwangju(),
    crawlChungnam(),
    crawlDaejeon(),
    crawlAllNttSites(),
  ]);

  const allJobs = [];
  const labels = [
    '부산', '전북', '경남', '강원',
    '서울', '경기', '광주', '충남', '대전',
    'NTT공통(인천·전남·경북·충북·세종)',
  ];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      const jobs = Array.isArray(result.value) ? result.value : [];
      allJobs.push(...jobs);
    } else {
      console.error(`[${labels[i]}] 크롤링 실패:`, result.reason.message);
    }
  });

  // 직종 필터 (기간제교사·강사만) → 마감일 임박순 정렬 (마감일 없는 건 맨 뒤)
  const validJobs = allJobs.filter(j => isRelevantJob(j.title));
  validJobs.sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline.localeCompare(b.deadline);
  });

  const output = {
    updated_at: new Date().toISOString(),
    total: validJobs.length,
    jobs: validJobs,
  };

  const outputPath = path.join(__dirname, '..', 'data', 'jobs.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n완료! 총 ${validJobs.length}건 → data/jobs.json 저장됨`);
}

main().catch(console.error);
