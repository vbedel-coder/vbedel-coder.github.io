// Appli hors ligne (fichiers gardés sur l'appareil) et notifications de fin de minuteur
const V="vivant-v5",FILES=["./","index.html","cloud.js","config.js","vendor/supabase.js","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
// Réseau d'abord, sans le cache du navigateur (nouvelle version dès l'ouverture), copie gardée si pas de réseau au fournil
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(e.request.method!=="GET"||u.origin!==location.origin)return;
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match("index.html"))));});
self.addEventListener("push",e=>{let d={};try{d=e.data.json();}catch(x){}
  e.waitUntil(self.registration.showNotification(d.title||"Minuteur terminé",{body:d.body||"",tag:d.tag||"tm",renotify:true,requireInteraction:true,icon:"icon-192.png",badge:"icon-192.png",data:{url:d.url||"./"}}));});
// Toucher la notification : ouvre l'appli (page Stock de farine pour l'alerte de commande)
self.addEventListener("notificationclick",e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||"./";
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>u!=="./"&&l.length&&l[0].navigate?l[0].navigate(u).then(c=>c&&c.focus()):l.length?l[0].focus():self.clients.openWindow(u)));});
