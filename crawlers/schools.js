/**
 * 학교 비교분석 데이터 수집기
 * NEIS OpenAPI + Kakao Local API → data/schools.json
 *
 * 실제 데이터:
 *   - 학급수       (NEIS classInfo)
 *   - 학교 좌표    (NEIS schoolInfo → Kakao geocoding)
 *   - 편의시설 점수 (Kakao 카테고리 검색, 반경 1km)
 *
 * 추정 데이터 (NEIS 무료키에 학생/교사 수 없음):
 *   - 학급당 학생수, 교사1인당 학생수, 학생수 증감률
 *   → 학교 유형·학급수 기반 합리적 추정값 + 교명 해시로 편차 부여
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const NEIS_KEY  = process.env.NEIS_API_KEY;
const KAKAO_KEY = process.env.KAKAO_API_KEY;

if (!NEIS_KEY || !KAKAO_KEY) {
  console.error('[학교데이터] API 키 없음 — 환경변수 NEIS_API_KEY, KAKAO_API_KEY 확인');
  process.exit(0); // 실패 아닌 스킵으로 처리
}

// ── 시도 → NEIS 교육청 코드 ──────────────────────────────────────────────────
const SIDO_ATPT = {
  '서울': 'B10', '부산': 'C10', '대구': 'D10', '인천': 'E10',
  '광주': 'F10', '대전': 'G10', '울산': 'H10', '세종': 'I10',
  '경기': 'J10', '강원': 'K10', '충북': 'M10', '충남': 'N10',
  '전북': 'P10', '전남': 'Q10', '경북': 'R10', '경남': 'S10', '제주': 'T10',
};

// ── 학교명 정규화 (약칭 → 전체명) ────────────────────────────────────────────
function expandName(name) {
  if (!name) return '';
  if (/초$/.test(name))  return name + '등학교';
  if (/중$/.test(name))  return name + '학교';
  if (/고$/.test(name))  return name + '등학교';
  if (/유$/.test(name))  return name + '치원';
  return name;
}

// ── 딜레이 ───────────────────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));

// ── NEIS: 학교 기본정보 ──────────────────────────────────────────────────────
async function neisSchoolInfo(schoolName, atptCode) {
  const url = `https://open.neis.go.kr/hub/schoolInfo`
    + `?KEY=${NEIS_KEY}&Type=json&pSize=5`
    + `&ATPT_OFCDC_SC_CODE=${atptCode}`
    + `&SCHUL_NM=${encodeURIComponent(schoolName)}`;
  try {
    const res = await fetch(url, { timeout: 8000 });
    const data = await res.json();
    const rows = data?.schoolInfo?.[1]?.row;
    if (!rows?.length) return null;
    // 정확히 이름이 같은 것 우선, 없으면 첫 번째
    return rows.find(r => r.SCHUL_NM === schoolName) || rows[0];
  } catch { return null; }
}

// ── NEIS: 학급 현황 ──────────────────────────────────────────────────────────
async function neisClassCount(atptCode, sdCode) {
  const year = new Date().getFullYear();
  const url = `https://open.neis.go.kr/hub/classInfo`
    + `?KEY=${NEIS_KEY}&Type=json&pSize=300`
    + `&ATPT_OFCDC_SC_CODE=${atptCode}`
    + `&SD_SCHUL_CODE=${sdCode}`
    + `&AY=${year}&SEM=1`;
  try {
    const res = await fetch(url, { timeout: 8000 });
    const data = await res.json();
    const rows = data?.classInfo?.[1]?.row;
    return rows?.length || 0;
  } catch { return 0; }
}

// ── Kakao: 주소 → 좌표 ──────────────────────────────────────────────────────
async function kakaoGeocode(address) {
  if (!address) return null;
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
      timeout: 8000,
    });
    const data = await res.json();
    const doc = data?.documents?.[0];
    if (!doc) return null;
    return { lat: parseFloat(doc.y), lng: parseFloat(doc.x) };
  } catch { return null; }
}

// ── Kakao: 반경 1km 편의시설 카운트 ─────────────────────────────────────────
// CE7=카페, CS2=편의점, MT1=대형마트, FD6=음식점, HP8=병원
const FACILITY_CATS = ['CE7', 'CS2', 'MT1', 'FD6'];

async function kakaoFacilityScore(lat, lng) {
  if (!lat || !lng) return null;
  let total = 0;
  for (const cat of FACILITY_CATS) {
    const url = `https://dapi.kakao.com/v2/local/search/category.json`
      + `?category_group_code=${cat}&x=${lng}&y=${lat}&radius=1000&size=15`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
        timeout: 8000,
      });
      const data = await res.json();
      total += data?.documents?.length || 0;
      await delay(100);
    } catch {}
  }
  // 0~60개 → 0~100점으로 정규화
  return Math.round(Math.min(total / 60, 1) * 100);
}

// ── 학교알리미 스크래핑 (실제 학생수·교원수) ──────────────────────────────
// URL: https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do
//      ?schulCode={SD_SCHUL_CODE}&schulCrseScCode={crse}&schulKndScCode={knd}
const SCHOOL_TYPE_CODES = {
  '유치원':   { crse: '2', knd: '01' },
  '초등학교': { crse: '1', knd: '02' },
  '중학교':   { crse: '3', knd: '03' },
  '고등학교': { crse: '4', knd: '04' },
  '특수학교': { crse: '5', knd: '05' },
};

async function scrapeSchoolAlimi(sdCode, schoolType, classCount) {
  if (!sdCode) return null;

  let codes = null;
  for (const [type, c] of Object.entries(SCHOOL_TYPE_CODES)) {
    if (schoolType?.includes(type)) { codes = c; break; }
  }
  if (!codes) return null;

  const url = `https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do`
    + `?schulCode=${sdCode}&schulCrseScCode=${codes.crse}&schulKndScCode=${codes.knd}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      timeout: 12000,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    let totalStudents = null;
    let teacherCount = null;
    let prevStudents = null;

    // 학교알리미 현황 테이블 파싱
    // 패턴1: <th>재학생수</th><td>XXX명</td>
    // 패턴2: summary/caption에 '현황' 포함 테이블
    $('table').each((_, table) => {
      const caption = $(table).find('caption').text();
      const summary = $(table).attr('summary') || '';
      const isRelevant = /현황|학생|교원|교사/.test(caption + summary);

      $(table).find('tr').each((_, tr) => {
        const ths = $(tr).find('th');
        const tds = $(tr).find('td');

        ths.each((i, th) => {
          const label = $(th).text().replace(/\s+/g, '').trim();
          const valTd = tds.eq(i).text().replace(/[^0-9]/g, '');
          const num = parseInt(valTd);
          if (isNaN(num) || num <= 0) return;

          if (/재학생|전체학생|학생수/.test(label) && !/(교사|학급|학년)/.test(label)) {
            if (!totalStudents || num > totalStudents) totalStudents = num;
          }
          if (/교원수|교사수|전체교원|재직교원/.test(label)) {
            if (!teacherCount || num > teacherCount) teacherCount = num;
          }
          // 전년도 학생수 (증감률 계산용) — 테이블에 연도별 컬럼이 있는 경우
          if (/전년|작년|[0-9]{4}학년도/.test(label) && /학생/.test(caption + summary)) {
            prevStudents = num;
          }
        });
      });
    });

    // dl/dt 패턴으로도 탐색 (학교알리미 일부 페이지)
    $('dl').each((_, dl) => {
      $(dl).find('dt').each((i, dt) => {
        const label = $(dt).text().replace(/\s+/g, '').trim();
        const dd = $(dl).find('dd').eq(i).text().replace(/[^0-9]/g, '');
        const num = parseInt(dd);
        if (isNaN(num) || num <= 0) return;
        if (/재학생|학생수/.test(label) && !/(교사|학급)/.test(label)) totalStudents = num;
        if (/교원수|교사수/.test(label)) teacherCount = num;
      });
    });

    if (!totalStudents) return null;

    const classStudentRatio = (classCount > 0 && totalStudents > 0)
      ? Math.round(totalStudents / classCount * 10) / 10 : null;
    const teacherStudentRatio = (teacherCount > 0 && totalStudents > 0)
      ? Math.round(totalStudents / teacherCount * 10) / 10 : null;
    const growthRate = (prevStudents > 0 && totalStudents > 0)
      ? Math.round((totalStudents - prevStudents) / prevStudents * 1000) / 10 : null;

    return { classStudentRatio, teacherStudentRatio, growthRate, totalStudents };
  } catch (e) {
    return null;
  }
}

// ── 추정값 생성 (학교알리미 스크래핑 실패 시 폴백) ──────────────────────────
function estimateSchoolStats(schoolName, schoolType, classCount) {
  // 결정론적 해시 (같은 학교 → 항상 같은 값)
  const h = [...(schoolName || '')].reduce((a, c, i) => a + c.charCodeAt(0) * (i + 3), 1);
  const rng = (seed, min, max) => min + ((h * seed * 2654435761) >>> 0) % (max - min + 1);

  // 학교 유형별 평균 학급당 학생수
  const baseRatio = schoolType?.includes('초') ? 21
    : schoolType?.includes('고') ? 24 : 23;
  const classStudentRatio = baseRatio + rng(7, -3, 4);

  // 교사1인당 학생수
  const teacherStudentRatio = Math.max(8,
    Math.round(classStudentRatio / (schoolType?.includes('초') ? 1.6 : 2.1) + rng(11, -1, 2))
  );

  // 학생수 증감률 (-12 ~ +8%)
  const growthRate = rng(13, -12, 8);

  return { classStudentRatio, teacherStudentRatio, growthRate, estimated: true };
}

// ── 학교 1개 처리 ────────────────────────────────────────────────────────────
async function processSchool(school, sido) {
  const atptCode = SIDO_ATPT[sido];
  if (!atptCode) return null;

  // NEIS 학교 검색 (전체명 → 약칭 순으로 시도)
  const fullName = expandName(school);
  let info = await neisSchoolInfo(fullName, atptCode);
  if (!info && fullName !== school) {
    await delay(200);
    info = await neisSchoolInfo(school, atptCode);
  }
  if (!info) return null;

  await delay(200);
  const classCount = await neisClassCount(atptCode, info.SD_SCHUL_CODE);

  await delay(200);
  const coords = await kakaoGeocode(info.ORG_RDNMA);

  await delay(200);
  const facilityScore = await kakaoFacilityScore(coords?.lat, coords?.lng);

  // 학교알리미 스크래핑 시도 (실제 학생수·교원수)
  await delay(300);
  const alimi = await scrapeSchoolAlimi(info.SD_SCHUL_CODE, info.SCHUL_KND_SC_NM, classCount);

  let classStudentRatio, teacherStudentRatio, growthRate, statsEstimated;
  if (alimi) {
    classStudentRatio   = alimi.classStudentRatio;
    teacherStudentRatio = alimi.teacherStudentRatio;
    growthRate          = alimi.growthRate;
    statsEstimated      = false;
  } else {
    const est = estimateSchoolStats(school, info.SCHUL_KND_SC_NM, classCount);
    classStudentRatio   = est.classStudentRatio;
    teacherStudentRatio = est.teacherStudentRatio;
    growthRate          = est.growthRate;
    statsEstimated      = true;
  }

  return {
    neisCode:    info.SD_SCHUL_CODE,
    atptCode,
    schoolType:  info.SCHUL_KND_SC_NM || '',
    address:     info.ORG_RDNMA || '',
    lat:         coords?.lat || null,
    lng:         coords?.lng || null,

    // 실제 데이터 (NEIS)
    classCount,
    // 실제 데이터 (Kakao)
    facilityScore,       // null이면 좌표 없음
    // 실제/추정 데이터 (학교알리미 우선, 실패 시 추정)
    classStudentRatio,
    teacherStudentRatio,
    growthRate,          // 학교알리미에 전년도 데이터 없으면 null 또는 추정
    statsEstimated,      // true면 학교알리미 스크래핑 실패 → 추정값

    updated: new Date().toISOString().split('T')[0],
  };
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function buildSchoolsData() {
  const jobsPath    = path.join(__dirname, '..', 'data', 'jobs.json');
  const outputPath  = path.join(__dirname, '..', 'data', 'schools.json');

  if (!fs.existsSync(jobsPath)) {
    console.error('[학교데이터] data/jobs.json 없음');
    return;
  }

  const { jobs } = JSON.parse(fs.readFileSync(jobsPath, 'utf-8'));

  // 기존 캐시 로드
  let cache = {};
  if (fs.existsSync(outputPath)) {
    try { cache = JSON.parse(fs.readFileSync(outputPath, 'utf-8')); } catch {}
  }

  // 오늘 날짜 (KST)
  const today = new Date(Date.now() + 9 * 3600000).toISOString().split('T')[0];

  // 현재 공고의 고유 학교 목록 수집
  const pairs = new Map();
  for (const job of jobs) {
    if (job.school && job.sido) {
      const key = `${job.sido}::${job.school}`;
      if (!pairs.has(key)) pairs.set(key, { school: job.school, sido: job.sido });
    }
  }

  console.log(`[학교데이터] ${pairs.size}개 학교 확인`);

  let fetched = 0, skipped = 0, failed = 0;

  for (const [key, { school, sido }] of pairs) {
    // 오늘 이미 수집한 건 스킵
    if (cache[key]?.updated === today) { skipped++; continue; }

    try {
      const data = await processSchool(school, sido);
      if (data) {
        cache[key] = data;
        fetched++;
        if (fetched % 10 === 0) console.log(`  [${fetched}/${pairs.size}] 진행 중...`);
      } else {
        failed++;
      }
    } catch (e) {
      console.error(`  [실패] ${key}:`, e.message);
      failed++;
    }

    await delay(400); // NEIS rate limit 대응
  }

  // 오래된 학교 (공고 없는) 제거
  for (const key of Object.keys(cache)) {
    if (!pairs.has(key)) delete cache[key];
  }

  fs.writeFileSync(outputPath, JSON.stringify(cache, null, 2), 'utf-8');
  console.log(`[학교데이터] 완료 — 신규 ${fetched}건 / 스킵 ${skipped}건 / 실패 ${failed}건`);
}

buildSchoolsData().catch(console.error);
