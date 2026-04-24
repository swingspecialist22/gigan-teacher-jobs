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
  const match = str.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function isExpired(deadlineStr) {
  if (!deadlineStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(deadlineStr);
  return deadline < today;
}

module.exports = { fetchHtml, parseDate, isExpired };
