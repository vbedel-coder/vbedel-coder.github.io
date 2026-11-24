// Appli hors ligne (fichiers gardés sur l'appareil) et notifications de fin de minuteur
const V="vivant-v12",FILES=["./","index.html","cloud.js","config.js","vendor/supabase.js","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES)).catch(()=>{}).then(()=>self.skipWaiting()));});
// Les anciennes copies sont effacées, mais la page ouverte n'est jamais reprise en cours de route (pas de clients.claim)
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))));});
// iPhone (WebKit) : une page servie par le service worker ne doit jamais être une réponse « redirigée », sinon écran blanc
const clean=r=>r&&r.redirected?r.blob().then(b=>new Response(b,{status:r.status,statusText:r.statusText,headers:r.headers})):Promise.resolve(r);
const keep=(req,r)=>{if(r&&r.ok&&r.type==="basic"){const c=r.clone();caches.open(V).then(x=>x.put(req,c)).catch(()=>{});}return r;};
const fromCache=req=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match("index.html")).then(r=>r||caches.match("./")).then(r=>r||Response.error());
// Réseau d'abord (nouvelle version dès l'ouverture), copie gardée si pas de réseau au fournil
self.addEventListener("fetch",e=>{const q=e.request,u=new URL(q.url);if(q.method!=="GET"||u.origin!==location.origin)return;
  const nav=q.mode==="navigate";
  e.respondWith((nav?fetch(q):fetch(q,{cache:"no-cache"})).then(clean).then(r=>keep(q,r)).catch(()=>fromCache(q).then(clean)));});
self.addEventListener("push",e=>{let d={};try{d=e.data.json();}catch(x){}
  e.waitUntil(self.registration.showNotification(d.title||"Minuteur terminé",{body:d.body||"",tag:d.tag||"tm",renotify:true,requireInteraction:true,icon:"icon-192.png",badge:"icon-192.png",data:{url:d.url||"./"}}));});
// Toucher la notification : ouvre l'appli (page Stock de farine pour l'alerte de commande)
self.addEventListener("notificationclick",e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||"./";
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>u!=="./"&&l.length&&l[0].navigate?l[0].navigate(u).then(c=>c&&c.focus()):l.length?l[0].focus():self.clients.openWindow(u)));});
