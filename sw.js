const CACHE = 'gigan-v1';
const DATA_URL = './data/jobs.json';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('jobs.json')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// 알림 체크: main thread에서 postMessage로 호출
self.addEventListener('message', async e => {
  if (e.data?.type !== 'CHECK_NEW_JOBS') return;

  const prefs = e.data.prefs || {};
  const seen = e.data.seen || [];

  let data;
  try {
    const res = await fetch(DATA_URL + '?t=' + Date.now());
    data = await res.json();
  } catch {
    return;
  }

  const jobs = data.jobs || [];
  const newMatches = jobs.filter(job => {
    if (seen.includes(job.id)) return false;
    if (prefs.sidos?.length && !prefs.sidos.includes(job.sido)) return false;
    if (prefs.levels?.length && job.level && !prefs.levels.includes(job.level)) return false;
    if (prefs.subjects?.length && job.subject && !prefs.subjects.some(s => job.subject.includes(s))) return false;
    return true;
  });

  if (newMatches.length === 0) return;

  const title = `기간제교사 새 공고 ${newMatches.length}건`;
  const body = newMatches.slice(0, 3).map(j => `[${j.sido}] ${j.title}`).join('\n');

  await self.registration.showNotification(title, {
    body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'new-jobs',
    renotify: true,
  });

  // 새로 본 항목 ID 목록을 client에 알림
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'NEW_JOB_IDS', ids: newMatches.map(j => j.id) }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(cs => {
      if (cs.length) return cs[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
