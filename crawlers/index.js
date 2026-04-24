const fs = require('fs');
const path = require('path');
const crawlBusan = require('./busan');
const crawlJeonbuk = require('./jeonbuk');

async function main() {
  console.log('크롤링 시작...');

  const results = await Promise.allSettled([
    crawlBusan(),
    crawlJeonbuk(),
  ]);

  const allJobs = [];
  results.forEach((result, i) => {
    const name = ['부산', '전북'][i];
    if (result.status === 'fulfilled') {
      allJobs.push(...result.value);
    } else {
      console.error(`[${name}] 크롤링 실패:`, result.reason.message);
    }
  });

  // 마감일 없는 공고 제외 후 빠른 마감 순 정렬
  const validJobs = allJobs.filter(j => j.deadline);
  validJobs.sort((a, b) => a.deadline.localeCompare(b.deadline));

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
