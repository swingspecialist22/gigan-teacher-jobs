/**
 * 학교알리미 UUID 수집기 v2
 * schoolinfo.go.kr Pneiss_f01_l0.do 검색 → SHL_IDF_CD(UUID) 추출
 * data/school-uuids.json 캐시
 *
 * 작동 방식:
 *  1. jobs.json에서 학교 목록 수집
 *  2. school-uuids.json 캐시에 없는 학교만 검색
 *  3. node-fetch + iconv-lite + cheerio (Puppeteer 없이 — 가볍고 빠름)
 *  4. UUID 확인되면 schools.js에서 실제 학생/교원 수 수집 가능
 */

const fetch  = require('node-fetch');
const iconv  = require('iconv-lite');
const cheerio = require('cheerio');
const fs     = require('fs');
const path   = require('path');

const CONCURRENCY  = 5;     // 동시 요청 수
const SEARCH_DELAY = 800;   // 요청 간 딜레이(ms) — 서버 부담 방지
const TIMEOUT      = 12000; // 요청 타임아웃(ms)

const delay = ms => new Promise(r => setTimeout(r, ms));

// UUID 패턴 (GUID 형식)
const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

// 공통 HTTP 헤더
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer':    'https://www.schoolinfo.go.kr/',
  'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 약칭 → 전체 학교명
function expandName(name) {
  if (!name) return '';
  if (/초$/.test(name)) return name + '등학교';
  if (/중$/.test(name)) return name + '학교';
  if (/고$/.test(name)) return name + '등학교';
  if (/유$/.test(name)) return name + '치원';
  return name;
}

// EUC-KR 또는 UTF-8 디코딩 (한국 정부 사이트 대응)
function decodeBuffer(buf) {
  // Content-Type charset 힌트 없이 EUC-KR 시도 후 UTF-8 확인
  const euckr = iconv.decode(buf, 'euc-kr');
  if (euckr.includes('학교') || euckr.includes('검색')) return euckr;
  const utf8 = buf.toString('utf-8');
  if (utf8.includes('학교') || utf8.includes('검색')) return utf8;
  return euckr; // 기본값
}

// ── 학교알리미 검색 (node-fetch, 브라우저 없음) ─────────────────────────────
async function fetchUUID(school, sido) {
  const fullName = expandName(school);
  const norm     = s => s.replace(/\s+/g, '');

  // ── 방법 1: JSON API (callbackMode=json) ──────────────────────────────────
  // JSON 응답에 UUID 또는 학교 상세 URL이 포함되어 있는지 확인
  try {
    const params = new URLSearchParams({
      SEARCH_SCHUL_NM: fullName,
      pageNumber:      '1',
      callbackMode:    'json',
      schulCrseScCode: '',
      hsKndScCode:     '',
      fondScCode:      '',
    });

    const res = await fetch('https://www.schoolinfo.go.kr/ei/ss/Pneiss_f01_l0.do', {
      method:  'POST',
      body:    params,
      timeout: TIMEOUT,
      headers: { ...COMMON_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (res.ok) {
      // UUID가 JSON 내부에 바로 있으면 추출
      const buf  = await res.buffer();
      const text = buf.toString('utf-8');
      const uuidInJson = text.match(UUID_RE);
      if (uuidInJson) return uuidInJson[0];

      // JSON 파싱 — 학교 목록에서 SCHUL_CODE 추출 후 상세 페이지로 접근
      let json;
      try { json = JSON.parse(text); } catch {}
      if (json) {
        const list = json.list || json.body || json.data
                  || (Array.isArray(json) ? json : null);
        if (list?.length) {
          const item = list.find(r =>
            norm(r.SCHUL_NM || '') === norm(fullName) ||
            norm(r.SCHUL_NM || '') === norm(school)
          ) || list[0];

          if (item?.SCHUL_CODE) {
            const uuid = await fetchUUIDBySchulCode(item.SCHUL_CODE);
            if (uuid) return uuid;
          }
        }
      }
    }
  } catch (e) {
    if (!e.message?.includes('maintenance') && !e.message?.includes('timeout')) {
      // 타임아웃 외 오류만 출력
    }
  }

  // ── 방법 2: HTML 검색 결과 페이지에서 SHL_IDF_CD 링크 추출 ─────────────
  try {
    const params = new URLSearchParams({
      SEARCH_SCHUL_NM: fullName,
      pageNumber:      '1',
      schulCrseScCode: '',
      hsKndScCode:     '',
      fondScCode:      '',
    });

    const res = await fetch('https://www.schoolinfo.go.kr/ei/ss/Pneiss_f01_l0.do', {
      method:  'POST',
      body:    params,
      timeout: TIMEOUT,
      headers: { ...COMMON_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!res.ok) return null;

    const buf  = await res.buffer();
    const html = decodeBuffer(buf);

    // 유지보수/점검 중 감지 — 에러를 던져 캐시에 null 저장 방지
    if (html.includes('일시 중단') || html.includes('서비스 점검')) {
      throw new Error('service_maintenance');
    }

    if (!UUID_RE.test(html)) return null;

    const $ = cheerio.load(html);
    let bestUuid = null;

    // SHL_IDF_CD가 포함된 <a> 태그에서 UUID 추출
    $('a[href*="SHL_IDF_CD"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = norm($(el).text());
      const m    = href.match(UUID_RE);
      if (!m) return;

      // 정확히 일치하는 학교명이면 즉시 반환
      if (text === norm(fullName) || text === norm(school)) {
        bestUuid = m[0];
        return false; // each() break
      }
      // 부분 일치 (첫 번째 후보로 저장)
      if (!bestUuid && (text.includes(norm(school)) || norm(fullName).includes(text))) {
        bestUuid = m[0];
      }
    });

    // 이름 매칭 실패 → 단일 결과면 그냥 사용 (신뢰도 높음)
    if (!bestUuid) {
      const allUuids = [...html.matchAll(new RegExp(UUID_RE.source, 'gi'))];
      if (allUuids.length === 1) bestUuid = allUuids[0][0];
    }

    return bestUuid || null;

  } catch (e) {
    if (!e.message?.includes('timeout')) {
      console.error(`  [HTML 오류] ${school}: ${e.message}`);
    }
    return null;
  }
}

// ── SCHUL_CODE → SHL_IDF_CD 변환 시도 ──────────────────────────────────────
// schoolinfo.go.kr의 내부 코드로 상세 페이지 접근 → URL에서 UUID 추출
async function fetchUUIDBySchulCode(schulCode) {
  if (!schulCode) return null;
  try {
    // SCHUL_CODE로 학교 페이지 접근 시도
    const res = await fetch(
      `https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SCHUL_CODE=${encodeURIComponent(schulCode)}`,
      {
        timeout: TIMEOUT,
        redirect: 'follow',
        headers: COMMON_HEADERS,
      }
    );
    if (!res.ok) return null;

    // 최종 URL에 UUID가 있으면 추출
    const finalUrl = res.url || '';
    const urlMatch = finalUrl.match(UUID_RE);
    if (urlMatch) return urlMatch[0];

    // 응답 HTML에서 UUID 추출
    const buf  = await res.buffer();
    const html = decodeBuffer(buf);
    const bodyMatch = html.match(UUID_RE);
    return bodyMatch ? bodyMatch[0] : null;

  } catch { return null; }
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

  // 캐시에 없는 학교만 수집 (null=시도했지만 못찾음 도 캐시에 있으면 스킵)
  const toFetch = [...pairs.entries()].filter(([key]) => !(key in cache));

  if (toFetch.length === 0) {
    console.log('[UUID수집] 신규 학교 없음 — 스킵');
    fs.writeFileSync(uuidsPath, JSON.stringify(cache, null, 2), 'utf-8');
    return;
  }

  console.log(`[UUID수집] ${toFetch.length}개 학교 UUID 수집 시작`);

  // 학교알리미 서비스 상태 확인
  try {
    const ping = await fetch('https://www.schoolinfo.go.kr/', {
      timeout: 8000,
      headers: COMMON_HEADERS,
    });
    const buf  = await ping.buffer();
    const html = decodeBuffer(buf);
    if (html.includes('일시 중단') || html.includes('서비스 점검')) {
      console.log('[UUID수집] 학교알리미 서비스 점검 중 — 스킵 (기존 캐시 유지)');
      fs.writeFileSync(uuidsPath, JSON.stringify(cache, null, 2), 'utf-8');
      return;
    }
  } catch (e) {
    console.log(`[UUID수집] 학교알리미 접속 불가 (${e.message}) — 스킵`);
    fs.writeFileSync(uuidsPath, JSON.stringify(cache, null, 2), 'utf-8');
    return;
  }

  let fetched = 0, failed = 0;

  // 배치 처리 (CONCURRENCY개씩)
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const chunk = toFetch.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      chunk.map(([, { school, sido }]) => fetchUUID(school, sido))
    );

    results.forEach((r, idx) => {
      const [key, { school }] = chunk[idx];
      const isMaintenance = r.status === 'rejected' &&
                            r.reason?.message === 'service_maintenance';
      // 점검 중 에러는 캐시 저장 스킵 (다음 실행 때 재시도)
      if (isMaintenance) { failed++; return; }

      const uuid = r.status === 'fulfilled' ? r.value : null;
      cache[key] = uuid; // null도 저장 (재시도 방지 — "검색했지만 없음")
      if (uuid) fetched++;
      else      failed++;
    });

    const done = Math.min(i + CONCURRENCY, toFetch.length);
    if (done % 20 === 0 || done === toFetch.length) {
      console.log(`  진행: ${done}/${toFetch.length} | UUID 확보: ${fetched}`);
      fs.writeFileSync(uuidsPath, JSON.stringify(cache, null, 2), 'utf-8');
    }

    if (i + CONCURRENCY < toFetch.length) await delay(SEARCH_DELAY);
  }

  fs.writeFileSync(uuidsPath, JSON.stringify(cache, null, 2), 'utf-8');
  console.log(`[UUID수집] 완료 — 확보: ${fetched} / 실패: ${failed} / 전체: ${toFetch.length}`);
}

main().catch(console.error);
