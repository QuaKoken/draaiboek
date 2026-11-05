import fs from "fs"; import crypto from "crypto"; import { build } from "esbuild";
const code = process.env.CODE; if (!code) throw new Error("CODE ontbreekt");
const cfg = fs.existsSync("firebase-config.json") ? fs.readFileSync("firebase-config.json","utf8") : JSON.stringify({apiKey:"demo",projectId:"demo-draaiboek",appId:"demo"});
const V = Date.now().toString(36);
fs.rmSync("public",{recursive:true,force:true}); fs.mkdirSync("public");
// content: install hint after nav
let html = fs.readFileSync("src/content.html","utf8");
html = html.replace('</nav>', '</nav>\n<div class="installhint" id="installhint" hidden><div class="wrap"><p><b>Tip:</b> zet deze app op je beginscherm. Op iPhone: tik in Safari op het deel-icoon en kies <b>Zet op beginscherm</b>.</p><button type="button">Sluit</button></div></div>');
const seed = JSON.parse(fs.readFileSync("src/seed.json","utf8"));
const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), iter = 250000;
const norm = code.trim().toLowerCase().replace(/\s+/g,"");
const key = crypto.pbkdf2Sync(norm, salt, iter, 32, "sha256");
const c = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([c.update(JSON.stringify({html, seed, ...JSON.parse(fs.readFileSync("src/meta.json","utf8"))}),"utf8"), c.final(), c.getAuthTag()]);
fs.writeFileSync("public/content.enc.json", JSON.stringify({v:1,iter,salt:salt.toString("base64"),iv:iv.toString("base64"),data:ct.toString("base64")}));
const dbkey = crypto.createHash("sha256").update("quakoken-draaiboek-db-v1:"+norm).digest("hex").slice(0,40);
fs.writeFileSync("firestore.rules", `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /draaiboeken/{boek} {
      allow get, create: if boek == "${dbkey}";
      match /acties/{actie} {
        allow read, delete: if boek == "${dbkey}";
        allow create, update: if boek == "${dbkey}"
          && request.resource.data.keys().hasOnly(['titel','eigenaar','deadline','status','notitie','volgorde','door','gewijzigd'])
          && request.resource.data.titel is string && request.resource.data.titel.size() <= 300
          && request.resource.data.status in ['open','bezig','klaar'];
      }
    }
  }
}
`);
fs.writeFileSync("src/config.build.js", fs.readFileSync("src/config.js","utf8").replace("__FIREBASE_CONFIG__", cfg));
await build({ entryPoints:["src/app.js"], bundle:true, minify:true, format:"esm", outfile:"public/app.bundle.js",
  logLevel:"warning" });
const css = fs.readFileSync("src/page.css","utf8");
fs.writeFileSync("public/index.html", fs.readFileSync("src/shell.html","utf8").replace("/*PAGE_CSS*/", css).replace("__V__", V));
fs.writeFileSync("public/manifest.webmanifest", JSON.stringify({name:"Draaiboek QuaKoken",short_name:"Draaiboek",start_url:"./",scope:"./",display:"standalone",background_color:"#4F4A22",theme_color:"#4F4A22",lang:"nl",
  icons:[{src:"icon-192.png",sizes:"192x192",type:"image/png"},{src:"icon-512.png",sizes:"512x512",type:"image/png"},{src:"icon-512.png",sizes:"512x512",type:"image/png",purpose:"maskable"}]},null,1));
fs.writeFileSync("public/sw.js", `const C="draaiboek-${V}";const F=["./","index.html","app.bundle.js?v=${V}","content.enc.json","manifest.webmanifest","icon-180.png","icon-192.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(e.request.method!=="GET"||u.origin!==location.origin)return;
e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request,{ignoreSearch:false}).then(r=>r||caches.match("index.html"))))});
`);
fs.writeFileSync("public/.nojekyll","");
for (const f of ["icon-180.png","icon-192.png","icon-512.png"]) fs.copyFileSync("icons/"+f,"public/"+f);
console.log("ok", V, "dbkey", dbkey.slice(0,6)+"…");
