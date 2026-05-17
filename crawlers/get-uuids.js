/**
 * 학교알리미 UUID 수집기
 * schoolinfo.go.kr 검색 → SHL_IDF_CD(UUID) 추출 → data/school-uuids.json 캐시
 *
 * 작동 방식:
 *  1. jobs.json에서 학교 목록 수집
 *  2. school-uuids.json 캐시에 없는 학교만 Puppeteer로 검색
 *  3. UUID 확인되면 schools.js에서 실제 학생/교원 수 수집 가능
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const CONCURRENCY  = 3;     // 동시 Puppeteer 페이지 수
const SEARCH_DELAY = 1200;  // 검색 간 딜레이(ms) — 서버 부담 방지

const delay = ms => new Promise(r => setTimeout(r, ms));

// 약칭 → 전체 학교명
function expandName(name) {
  if (!name) return '';
  if (/초$/.test(name)) return name + '등학교';
  if (/중$/.test(name)) return name + '학교';
  if (/고$/.test(name)) return name + '등학교';
  if (/유$/.test(name)) return name + '치원';
  return name;
}

// 학교알리미에서 UUID 검색 (페이지 1개)
async function fetchUUID(browser, school, sido) {
  const fullName = expandName(school);
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setDefaultNavigationTimeout(30000);
    await page.setDefaultTimeout(20000);

    // ── 1. 학교알리미 학교 검색 페이지 ──
    await page.goto('https://www.schoolinfo.go.kr/ei/ss/Pneiss_a01_s0.do', {
      waitUntil: 'networkidle2',
    });
    await delay(400);

    // ── 2. 검색창 찾기 (여러 selector 시도) ──
    const INPUT_SELECTORS = [
      '#schulNm', '#schoolNm', '#schlNm',
      'input[name="schulNm"]', 'input[name="schoolNm"]',
      'input[placeholder*="학교"]', 'input[type="text"]',
    ];
    let inputSel = null;
    for (const sel of INPUT_SELECTORS) {
      if (await page.$(sel)) { inputSel = sel; break; }
    }
    if (!inputSel) {
      console.log(`  [UUID] 검색창 없음: ${school}`);
      return null;
    }

    // ── 3. 학교명 입력 + 검색 ──
    await page.click(inputSel, { clickCount: 3 });
    await page.type(inputSel, fullName, { delay: 40 });
    await delay(200);

    // Enter 또는 검색 버튼
    const BTN_SELECTORS = [
      '#btnSearch', '#searchBtn', 'button[type="submit"]',
      'a.btn-search', 'input[type="submit"]',
    ];
    let clicked = false;
    for (const sel of BTN_SELECTORS) {
      if (await page.$(sel)) {
        await Promise.all([
          page.click(sel),
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
        ]);
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      await Promise.all([
        page.keyboard.press('Enter'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
      ]);
    }
    await delay(600);

    // ── 4. 결과에서 SHL_IDF_CD 추출 ──
    const uuid = await page.evaluate((full, short) => {
      const links = Array.from(document.querySelectorAll('a[href*="SHL_IDF_CD"]'));
      if (!links.length) return null;

      const norm = s => s.replace(/\s+/g, '');

      // 완전 일치 우선
      for (const a of links) {
        const t = norm(a.textContent);
        if (t === norm(full) || t === norm(short)) {
          const m = a.href.match(/SHL_IDF_CD=([^&\s"']+)/i);
          if (m) return m[1];
        }
      }
      // 부분 일치
      for (const a of links) {
        const t = norm(a.textContent);
        if (t.includes(norm(short)) || norm(full).includes(t)) {
          const m = a.href.match(/SHL_IDF_CD=([^&\s"']+)/i);
          if (m) return m[1];
        }
      }
      // 첫 번째 결과
      const m = links[0].href.match(/SHL_IDF_CD=([^&\s"']+)/i);
      return m ? m[1] : null;
    }, fullName, school);

    return uuid || null;

  } catch (e) {
    console.error(`  [UUID 오류] ${school}: ${e.message}`);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const jobsPath  = path.join(__dirname, '..', 'data', 'jobs.json');
  const uuidsPath = path.join(__dirname, '..', 'data', 'school-uuids.json');

  if (!fs.existsSync(jobsPath)) {
    console.error('[UUID수집] data/jobs.json 없음');
    process.exit(0);
  }

  const { jobs } = JSON.parse(fs.readFileSync(jobsPath, 'utf-8'));

  // 기존 캐시 로드
  let cache = {};
  if (fs.existsSync(uuidsPath)) {
    try { cache = JSON.parse(fs.readFileSync(uuidsPath, 'utf-8')); } catch {}
  }

  // jobs에서 고유 학교 목록 수집
  const pairs = new Map();
  for (const job of jobs) {
    if (job.school && job.sido) {
      const key = `${job.sido}::${job.school}`;
      if (!pairs.has(key)) pairs.set(key, { school: job.school, sido: job.sido });
    }
  }

  // 현재 공고에 없는 학교는 캐시에서 제거
  for (const key of Object.keys(cache)) {
    if (!pairs.has(key)) delete cache[key];
  }

  // 캐시에 없는 학교만 수집 (null 포함 — null은 "시도했지만 못찾음")
  const toFetch = [...pairs.entries()].filter(([key]) => !(key in cache));

  if (toFetch.length === 0) {
    console.log('[UUID수집] 신규 학교 없음 — 스킵');
    fs.writeFileSync(uuidsPath, JSON.stringify(cache, null, 2), 'utf-8');
    return;
  }

  console.log(`[UUID수집] ${toFetch.length}개 학교 UUID 수집 (병렬 ${CONCURRENCY}개)`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  let fetched = 0, failed = 0;

  try {
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
      const chunk = toFetch.slice(i, i + CONCURRENCY);

      const results = await Promise.allSettled(
        chunk.map(([, { school, sido }]) => fetchUUID(browser, school, sido))
      );

      results.forEach((r, idx) => {
        const [key] = chunk[idx];
        const uuid = r.status === 'fulfilled' ? r.value : null;
        cache[key] = uuid; // null도 저장 (재시도 방지)
        if (uuid) fetched++; else failed++;
      });

      const done = Math.min(i + CONCURRENCY, toFetch.length);
      if (done % 30 === 0 || done === toFetch.length) {
        console.log(`  진행: ${done}/${toFetch.length} | UUID 확보: ${fetched}`);
        fs.writeFileSync(uuidsPath, JSON.stringify(cache, null, 2), 'utf-8'); // 중간 저장
      }

      if (i + CONCURRENCY < toFetch.length) await delay(SEARCH_DELAY);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  fs.writeFileSync(uuidsPath, JSON.stringify(cache, null, 2), 'utf-8');
  console.log(`[UUID수집] 완료 — 확보: ${fetched} / 실패: ${failed} / 전체: ${toFetch.length}`);
}

main().catch(console.error);
