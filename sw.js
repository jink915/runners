// 앱 화면은 캐시해 두고 오프라인에서도 열리게, 본문 데이터는 항상 최신을 먼저 시도
const V = "runners-v51";
const SHELL = ["./", "index.html", "style.css", "app.js", "firebase-config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "img/sheep-heart.webp", "img/sheep-wave.webp", "img/sheep-pray.webp"];
const SDK = ["firebase-app.js","firebase-auth.js","firebase-firestore.js","firebase-messaging.js"].map(f=>"https://www.gstatic.com/firebasejs/10.12.2/"+f);

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL).then(()=>Promise.allSettled(SDK.map(u=>c.add(u))))).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; if(req.method!=="GET") return;
  const url = new URL(req.url);
  if(url.origin===location.origin){
    if(url.pathname.endsWith("/data/sermons.json")){
      e.respondWith(fetch(req).then(r=>{ const c=r.clone(); caches.open(V).then(x=>x.put(req,c)); return r; }).catch(()=>caches.match(req)));
      return;
    }
    // 화면 파일: 항상 최신을 먼저 받고(3초 안에), 오프라인·느릴 때만 저장해 둔 것 사용
    e.respondWith((async () => {
      const net = fetch(req, {cache:"no-cache"}).then(r=>{ if(r.ok){ const c=r.clone(); caches.open(V).then(x=>x.put(req,c)); } return r; });
      const hit = await caches.match(req);
      if(!hit) return net.catch(()=>caches.match("index.html"));
      return Promise.race([net, new Promise(res=>setTimeout(()=>res(hit), 3000))]).catch(()=>hit);
    })());
    return;
  }
  if(url.href.startsWith("https://www.gstatic.com/firebasejs/") || url.host==="fonts.gstatic.com" || url.host==="fonts.googleapis.com"){
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r=>{ const c=r.clone(); caches.open(V).then(x=>x.put(req,c)); return r; })));
  }
});

// 사회자 알림: 서버(GitHub Actions → Firebase)가 보낸 푸시를 알림으로 띄우기
self.addEventListener("push", e => {
  let d = {};
  try { const j = e.data ? e.data.json() : {}; d = { ...(j.notification||{}), ...(j.data||{}) }; } catch { d = { body: e.data && e.data.text() }; }
  const title = d.title || "러너스";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    tag: d.tag || "runners", renotify: true, data: { link: d.link || "./#dash" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const link = new URL(e.notification.data?.link || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const c = list.find(w => w.url.startsWith(self.registration.scope));
    if (c) { c.navigate(link).catch(()=>{}); return c.focus(); }
    return self.clients.openWindow(link);
  }));
});
