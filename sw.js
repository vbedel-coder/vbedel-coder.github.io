// Appli hors ligne (fichiers gardés sur l'appareil) et notifications de fin de minuteur
const V="vivant-v9";
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
// 24/11/2026 : plus d'interception des pages (écran blanc de l'appli installée sur iPhone) ; on garde seulement les notifications
self.addEventListener("push",e=>{let d={};try{d=e.data.json();}catch(x){}
  e.waitUntil(self.registration.showNotification(d.title||"Minuteur terminé",{body:d.body||"",tag:d.tag||"tm",renotify:true,requireInteraction:true,icon:"icon-192.png",badge:"icon-192.png",data:{url:d.url||"./"}}));});
// Toucher la notification : ouvre l'appli (page Stock de farine pour l'alerte de commande)
self.addEventListener("notificationclick",e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||"./";
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>u!=="./"&&l.length&&l[0].navigate?l[0].navigate(u).then(c=>c&&c.focus()):l.length?l[0].focus():self.clients.openWindow(u)));});
