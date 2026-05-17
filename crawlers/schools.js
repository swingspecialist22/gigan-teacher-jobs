/**
 * 학교 비교분석 데이터 수집기
 * NEIS OpenAPI + Kakao Local API + 학교알리미(schoolinfo.go.kr) → data/schools.json
 *
 * 실제 데이터:
 *   - 학급수          (NEIS classInfo)
 *   - 학교 좌표       (NEIS schoolInfo → Kakao geocoding)
 *   - 편의시설 점수   (Kakao 카테고리 검색, 반경 1km)
 *   - 학생수·교원수   (학교알리미 UUID → EUC-KR 디코딩 파싱)
 *
 * 추정 데이터 (학교알리미 UUID 없는 학교):
 *   - 학급당 학생수, 교사1인당 학생수, 학생수 증감률
 *   → 학교 유형·학급수 기반 합리적 추정값
 */

const fetch = require('node-fetch');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');
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

// ── 학교알리미: 실제 학생수·교원수 수집 ─────────────────────────────────────
async function schoolinfoStats(uuid) {
  if (!uuid) return null;
  const url = `https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${uuid}`;
  try {
    const res = await fetch(url, {
      timeout: 10000,
      headers: { 'Accept-Charset': 'euc-kr' },
    });
    if (!res.ok) return null;

    // EUC-KR 디코딩
    const buf = await res.buffer();
    const html = iconv.decode(buf, 'euc-kr');
    const $ = cheerio.load(html);

    // 학생수 추출 — 여러 패턴 시도
    let students = null, teachers = null;

    // 패턴 1: 숫자만 있는 td에서 합계 행 찾기
    $('table').each((_, tbl) => {
      const text = $(tbl).text();
      if (!/학생/.test(text)) return;
      // "합계" 또는 "전체" 행의 숫자
      $(tbl).find('tr').each((_, tr) => {
        const rowText = $(tr).text();
        if (!/합계|전체/.test(rowText)) return;
        const nums = rowText.match(/[\d,]+/g)?.map(n => parseInt(n.replace(/,/g, ''), 10)).filter(n => n > 10 && n < 5000);
        if (nums?.length) { students = nums[0]; return false; }
      });
    });

    // 패턴 2: 정규식 직접 매칭
    if (!students) {
      const m = html.match(/(?:학생수|전체학생|총\s*학생)[^<\d]*(\d[\d,]+)/);
      if (m) students = parseInt(m[1].replace(/,/g, ''), 10);
    }

    // 교원수 추출
    $('table').each((_, tbl) => {
      const text = $(tbl).text();
      if (!/교원|교직원/.test(text)) return;
      $(tbl).find('tr').each((_, tr) => {
        const rowText = $(tr).text();
        if (!/합계|전체/.test(rowText)) return;
        const nums = rowText.match(/[\d,]+/g)?.map(n => parseInt(n.replace(/,/g, ''), 10)).filter(n => n > 3 && n < 500);
        if (nums?.length) { teachers = nums[0]; return false; }
      });
    });

    if (!teachers) {
      const m = html.match(/(?:교원수|교직원수|총\s*교원)[^<\d]*(\d[\d,]+)/);
      if (m) teachers = parseInt(m[1].replace(/,/g, ''), 10);
    }

    if (!students || !teachers) return null;
    return { students, teachers };

  } catch { return null; }
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
    if (!kakaoGeocode._logged) {
      kakaoGeocode._logged = true;
      console.log(`[Kakao 디버그] status=${res.status} keys=${Object.keys(data||{}).join(',')} msg=${data?.message||''} docLen=${data?.documents?.length??'?'}`);
    }
    const doc = data?.documents?.[0];
    if (!doc) return null;
    return { lat: parseFloat(doc.y), lng: parseFloat(doc.x) };
  } catch (e) {
    if (!kakaoGeocode._errLogged) { kakaoGeocode._errLogged = true; console.error('[Kakao 디버그] 오류:', e.message); }
    return null;
  }
}

// ── Kakao: 반경 1km 편의시설 카운트 ─────────────────────────────────────────
// CE7=카페, CS2=편의점, MT1=대형마트, FD6=음식점
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

// ── Kakao: 반경 1km 지하철역 수 → 대중교통 접근성 점수 ──────────────────────
// SW8=지하철역  (0개=0점 / 1개=34점 / 2개=67점 / 3개+=100점)
async function kakaoTransitScore(lat, lng) {
  if (!lat || !lng) return null;
  const url = `https://dapi.kakao.com/v2/local/search/category.json`
    + `?category_group_code=SW8&x=${lng}&y=${lat}&radius=1000&size=15`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
      timeout: 8000,
    });
    const data = await res.json();
    const count = data?.documents?.length || 0;
    return Math.min(Math.round(count / 3 * 100), 100);
  } catch { return null; }
}

// ── 학교 유형별 통계 추정 (교육부 공시 평균 기반) ──────────────────────────
// 출처: 교육부 교육통계서비스 2024년 기준
// classCount는 NEIS 실측값 → 이를 기반으로 학생수·교원수 역산
function calcSchoolStats(schoolName, schoolType, classCount) {
  // 결정론적 해시 (같은 학교 → 항상 같은 편차)
  const h = [...(schoolName || '')].reduce((a, c, i) => a + c.charCodeAt(0) * (i + 3), 1);
  const rng = (seed, min, max) => min + ((h * seed * 2654435761) >>> 0) % (max - min + 1);

  // 학교 유형별 학급당 평균 학생수 (2024 교육부 통계)
  let avgPerClass, teacherRatio;
  if (schoolType?.includes('초')) {
    avgPerClass  = 20 + rng(7, -2, 3);   // 전국 평균 20.3명
    teacherRatio = 14 + rng(11, -2, 2);  // 교사1인당 학생 14.1명
  } else if (schoolType?.includes('고')) {
    avgPerClass  = 23 + rng(7, -2, 3);   // 전국 평균 23.4명
    teacherRatio = 10 + rng(11, -1, 2);  // 교사1인당 학생 10.6명
  } else {
    avgPerClass  = 25 + rng(7, -2, 3);   // 중학교 전국 평균 25.0명
    teacherRatio = 12 + rng(11, -1, 2);  // 교사1인당 학생 11.8명
  }

  // classCount가 실측값이면 그걸로 학생수 계산, 없으면 규모도 추정
  const effectiveClassCount = classCount > 0 ? classCount : (6 + rng(6, 0, 36));
  const estimatedStudents   = effectiveClassCount * avgPerClass;

  const classStudentRatio   = avgPerClass;
  const teacherStudentRatio = teacherRatio;

  return { classStudentRatio, teacherStudentRatio };
}


// ── 학교 1개 처리 ────────────────────────────────────────────────────────────
async function processSchool(school, sido, uuid) {
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
  const facilityScore  = await kakaoFacilityScore(coords?.lat, coords?.lng);

  await delay(200);
  const transitScore   = await kakaoTransitScore(coords?.lat, coords?.lng);

  // ── 학교알리미 실제 데이터 (UUID 있을 때) ──────────────────────────────────
  let classStudentRatio, teacherStudentRatio, statsEstimated;

  const realStats = uuid ? await schoolinfoStats(uuid) : null;

  if (realStats && realStats.students > 0 && realStats.teachers > 0) {
    const effectiveClassCount = classCount > 0 ? classCount : 1;
    classStudentRatio   = Math.round(realStats.students / effectiveClassCount * 10) / 10;
    teacherStudentRatio = Math.round(realStats.students / realStats.teachers * 10) / 10;
    statsEstimated      = false;
    console.log(`  ✓ 실제데이터 ${school}: 학생${realStats.students} 교원${realStats.teachers} → 학급당${classStudentRatio} 교사당${teacherStudentRatio}`);
  } else {
    // UUID 없거나 파싱 실패 → 통계 추정
    const est = calcSchoolStats(school, info.SCHUL_KND_SC_NM, classCount);
    classStudentRatio   = est.classStudentRatio;
    teacherStudentRatio = est.teacherStudentRatio;
    statsEstimated      = true;
  }

  return {
    neisCode:    info.SD_SCHUL_CODE,
    atptCode,
    schoolType:  info.SCHUL_KND_SC_NM || '',
    address:     info.ORG_RDNMA || '',
    lat:         coords?.lat || null,
    lng:         coords?.lng || null,

    classCount,          // NEIS 실측
    facilityScore,       // Kakao 실측 (null이면 좌표 없음)
    transitScore,        // Kakao 실측 — 1km 내 지하철역 수 기반 (null이면 좌표 없음)

    classStudentRatio,   // 학교알리미 실측 or 통계 추정
    teacherStudentRatio, // 학교알리미 실측 or 통계 추정
    statsEstimated,      // false=실제데이터 / true=추정

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

  // 학교알리미 UUID 캐시 로드
  const uuidsPath = path.join(__dirname, '..', 'data', 'school-uuids.json');
  let uuids = {};
  if (fs.existsSync(uuidsPath)) {
    try { uuids = JSON.parse(fs.readFileSync(uuidsPath, 'utf-8')); } catch {}
  }
  const uuidCount = Object.values(uuids).filter(v => v !== null).length;
  console.log(`[학교데이터] UUID 캐시: ${uuidCount}개 학교 실제데이터 가능`);

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

  const forceRefresh = process.env.FORCE_REFRESH === '1';
  if (forceRefresh) console.log('[학교데이터] 강제 새로고침 모드 — 캐시 무시');

  for (const [key, { school, sido }] of pairs) {
    // 오늘 이미 수집한 건 스킵 — 단, UUID 있는데 아직 추정값이면 재수집
    const cached = cache[key];
    const uuid = uuids[key] || null;
    const needsRealData = uuid && cached?.statsEstimated === true;
    if (!forceRefresh && cached?.updated === today && !needsRealData) { skipped++; continue; }

    try {
      const data = await processSchool(school, sido, uuid);
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
