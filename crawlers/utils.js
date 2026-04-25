const fetch = require('node-fetch');
const cheerio = require('cheerio');
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
  // 1차: 괄호 안 텍스트
  const match = title.match(/[（(]([^)）]{1,15})[)）]/);
  if (match) return match[1];
  // 2차: 제목 내 키워드 스캔
  for (const kw of SUBJECT_KEYWORDS) {
    if (title.includes(kw)) return kw;
  }
  return '';
}

function extractLevel(title) {
  if (title.includes('초등') || title.includes('초교')) return '초등';
  if (title.includes('중학') || title.includes('중교')) return '중등';
  if (title.includes('고등') || title.includes('고교')) return '고등';
  if (title.includes('유치')) return '유치';
  if (title.includes('특수')) return '특수';
  return '';
}

module.exports = { fetchHtml, parseDate, isExpired, extractSubject, extractLevel };
