// Bouwt een eigen draaiboek-app per bruidspaar in docs/<boek>/ (gepubliceerd op GitHub Pages).
// Gebruik: BOEK=neil-lotte CODE=<toegangscode> node build-boek.mjs
// Invoer (niet in git, bevat de leesbare inhoud): src/boeken/<boek>/content.html, seed.json, meta.json, page.css
// Gedeeld: src/app.js, src/shell.html, assets/ (logo), icons/<boek>/ (app-iconen)
import fs from "fs"; import crypto from "crypto"; import { build } from "esbuild";

const boek = process.env.BOEK, code = process.env.CODE;
if (!boek || !/^[a-z0-9-]+$/.test(boek)) throw new Error("BOEK ontbreekt of is ongeldig");
if (!code) throw new Error("CODE ontbreekt");
const dir = `src/boeken/${boek}`, out = `docs/${boek}`;
const cfg = fs.readFileSync("firebase-config.json", "utf8");
const meta = JSON.parse(fs.readFileSync(`${dir}/meta.json`, "utf8"));
const seed = JSON.parse(fs.readFileSync(`${dir}/seed.json`, "utf8"));
const V = Date.now().toString(36);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });

// Versleutelde inhoud
let html = fs.readFileSync(`${dir}/content.html`, "utf8");
html = html.replace("</nav>", '</nav>\n<div class="installhint" id="installhint" hidden><div class="wrap"><p><b>Tip:</b> zet deze app op je beginscherm. Op iPhone: tik in Safari op het deel-icoon en kies <b>Zet op beginscherm</b>.</p><button type="button">Sluit</button></div></div>');
const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), iter = 250000;
const norm = code.trim().toLowerCase().replace(/\s+/g, "");
const key = crypto.pbkdf2Sync(norm, salt, iter, 32, "sha256");
const c = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([c.update(JSON.stringify({ html, seed, ...meta }), "utf8"), c.final(), c.getAuthTag()]);
fs.writeFileSync(`${out}/content.enc.json`, JSON.stringify({ v: 1, iter, salt: salt.toString("base64"), iv: iv.toString("base64"), data: ct.toString("base64") }));

// Databasesleutel van dit draaiboek toevoegen aan de beveiligingsregels (alle draaiboeken samen)
const dbkey = crypto.createHash("sha256").update("quakoken-draaiboek-db-v1:" + norm).digest("hex").slice(0, 40);
const keys = JSON.parse(fs.readFileSync("dbkeys.json", "utf8"));
keys[boek] = dbkey;
fs.writeFileSync("dbkeys.json", JSON.stringify(keys, null, 1) + "\n");
const list = Object.values(keys).map(k => `"${k}"`).join(", ");
fs.writeFileSync("firestore.rules", `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /draaiboeken/{boek} {
      allow get, create: if boek in [${list}];
      match /acties/{actie} {
        allow read, delete: if boek in [${list}];
        allow create, update: if boek in [${list}]
          && request.resource.data.keys().hasOnly(['titel','eigenaar','deadline','status','notitie','volgorde','door','gewijzigd'])
          && request.resource.data.titel is string && request.resource.data.titel.size() <= 300
          && request.resource.data.status in ['open','bezig','klaar'];
      }
    }
  }
}
`);

// App-code
fs.writeFileSync("src/config.build.js", fs.readFileSync("src/config.js", "utf8").replace("__FIREBASE_CONFIG__", cfg));
await build({ entryPoints: ["src/app.js"], bundle: true, minify: true, format: "esm", outfile: `${out}/app.bundle.js`,
  define: { __BOEK__: JSON.stringify(boek) }, logLevel: "warning" });

// Pagina, kleuren en logo
const css = fs.readFileSync(`${dir}/page.css`, "utf8");
const short = meta.short || meta.title;
let shell = fs.readFileSync("src/shell.html", "utf8")
  .replace("/*PAGE_CSS*/", css).replace("__V__", V)
  .replace("<title>Draaiboek · QuaKoken</title>", `<title>${meta.title}</title>`)
  .replace('content="Draaiboek">', `content="${short}">`)
  .replaceAll("#4F4A22", meta.theme || "#4F4A22")
  .replace('<div class="eyebrow">QuaKoken</div>', `<img src="logo-licht.svg" alt="QuaKoken restaurant en catering" width="112" height="112" style="width:112px;height:112px;margin:0 auto">\n    <div class="eyebrow">${meta.lockLabel || "QuaKoken"}</div>`);
fs.writeFileSync(`${out}/index.html`, shell);
const theme = meta.theme || "#4F4A22";
fs.writeFileSync(`${out}/manifest.webmanifest`, JSON.stringify({ name: meta.title, short_name: short, start_url: "./", scope: "./", display: "standalone", background_color: theme, theme_color: theme, lang: "nl",
  icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icon-512.png", sizes: "512x512", type: "image/png" }, { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] }, null, 1));
fs.writeFileSync(`${out}/sw.js`, `const C="draaiboek-${boek}-${V}";const F=["./","index.html","app.bundle.js?v=${V}","content.enc.json","manifest.webmanifest","icon-180.png","icon-192.png","logo-licht.svg","logo-donker.svg"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith("draaiboek-${boek}-")&&x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(e.request.method!=="GET"||u.origin!==location.origin||!u.pathname.startsWith(new URL("./",self.registration.scope).pathname))return;
e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request,{ignoreSearch:false}).then(r=>r||caches.match("index.html"))))});
`);
for (const f of ["icon-180.png", "icon-192.png", "icon-512.png"]) fs.copyFileSync(`icons/${boek}/${f}`, `${out}/${f}`);
for (const f of ["logo-licht.svg", "logo-donker.svg"]) fs.copyFileSync(`assets/${f}`, `${out}/${f}`);
console.log("ok", boek, V, "dbkey", dbkey.slice(0, 6) + "…");
