const fetch = require('node-fetch');
const iconv = require('iconv-lite');

async function fetchHtml(url, encoding = 'utf-8') {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  if (!res.ok) throw new Error(`fetch 실패: ${url} (${res.status})`);
  const buffer = await res.buffer();
  return iconv.decode(buffer, encoding);
}

function parseDate(str) {
  if (!str) return null;
  const match = str.match(/(\d{4})[\s.\-\/]+(\d{1,2})[\s.\-\/]+(\d{1,2})/);
  if (!match) return null;
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${match[1]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isExpired(deadlineStr) {
  if (!deadlineStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(deadlineStr);
  return deadline < today;
}

// 마감일이 N일 이상 지났으면 true → 페이지네이션 중단 신호용
function isOldExpired(deadlineStr, days = 3) {
  if (!deadlineStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(deadlineStr);
  return today - deadline > days * 24 * 60 * 60 * 1000;
}

// 직종 필터 — 기간제교사·강사만 수집
const EXCLUDE_RE = /자원봉사|봉사자|조리|배식|배움터지킴이|돌봄전담사|사무직|행정직|보조인력/;
const INCLUDE_RE = /기간제|계약제|강사|교원|교사/;

function isRelevantJob(title) {
  if (!title) return false;
  if (EXCLUDE_RE.test(title)) return false;
  return INCLUDE_RE.test(title);
}

// colLevel 원시값 → 표준값 변환
function normalizeLevel(raw) {
  if (!raw) return '';
  if (/초등학교|^초등$/.test(raw)) return '초등';
  if (/중학교|^중등$/.test(raw)) return '중등';
  if (/고등학교|^고등$/.test(raw)) return '고등';
  if (/유치원|^유치$/.test(raw)) return '유치';
  if (/특수학교|^특수$/.test(raw)) return '특수';
  return ''; // 기관/기타/보건 등 → extractLevel로 fallback
}

// 과목 키워드 — 긴 것 먼저 (부분 매칭 방지)
const SUBJECT_KEYWORDS = [
  '생명과학', '지구과학', '사회문화', '기술가정', '생활과윤리', '세계지리', '세계사',
  '정보통신', '한국사', '물리학', '물리', '화학', '생물',
  '국어', '영어', '수학', '과학', '사회', '역사', '도덕', '윤리',
  '체육', '음악', '미술', '기술', '가정', '정보', '컴퓨터',
  '지리', '경제', '정치', '법', '한문',
  '일본어', '중국어', '프랑스어', '독일어', '스페인어',
  '진로', '상담', '보건', '영양', '사서', '논술',
];

function extractSubject(title) {
  const match = title.match(/[（(]([^)）]{1,15})[)）]/);
  if (match) return match[1];
  for (const kw of SUBJECT_KEYWORDS) {
    if (title.includes(kw)) return kw;
  }
  return '';
}

function extractLevel(title, school = '') {
  const src = title + ' ' + school;

  // 전체 교명 (우선)
  if (/고등학교|고교/.test(src)) return '고등';
  if (/초등학교|초교/.test(src)) return '초등';
  if (/중학교/.test(src)) return '중등';
  if (/유치원/.test(src)) return '유치';
  if (/특수학교/.test(src)) return '특수';

  // 약칭 키워드
  if (/여고|공업고|상업고/.test(src)) return '고등';
  if (/여중/.test(src)) return '중등';

  // 학교 약칭 패턴: 한글2자 이상 + 초/중/고 + (공백·괄호·끝)
  if (/[가-힣]{2}고([\s\(,\/]|$)/.test(src)) return '고등';
  if (/[가-힣]{2}초([\s\(,\/]|$)/.test(src)) return '초등';
  if (/[가-힣]{2}중([\s\(,\/]|$)/.test(src)) return '중등';

  // 제목 키워드
  if (/초등|[1-6]학년 담임/.test(title)) return '초등';
  if (/중학|중등/.test(title)) return '중등';
  if (/고등/.test(title)) return '고등';
  if (/유치/.test(title)) return '유치';
  if (/특수/.test(title)) return '특수';

  return '';
}

module.exports = { fetchHtml, parseDate, isExpired, isOldExpired, isRelevantJob, normalizeLevel, extractSubject, extractLevel };
