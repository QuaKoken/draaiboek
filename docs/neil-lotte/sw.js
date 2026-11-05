const C="draaiboek-neil-lotte-mw3xvh92";const F=["./","index.html","app.bundle.js?v=mw3xvh92","content.enc.json","manifest.webmanifest","icon-180.png","icon-192.png","logo-licht.svg","logo-donker.svg"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith("draaiboek-neil-lotte-")&&x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(e.request.method!=="GET"||u.origin!==location.origin||!u.pathname.startsWith(new URL("./",self.registration.scope).pathname))return;
e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request,{ignoreSearch:false}).then(r=>r||caches.match("index.html"))))});
