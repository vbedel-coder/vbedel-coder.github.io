// Vivant hors de Claude : remplace window.claude (db, user, downloads) par Supabase, avec la même interface que l'appli utilise.
// config.js (écrit par le déploiement) donne SB_URL et SB_KEY.
(()=>{
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").then(()=>{if(window.vivantPush&&window.Notification&&Notification.permission==="granted")window.vivantPush();}).catch(()=>{});
const C=window.VIVANT_CONFIG||{};
if(!C.SB_URL||!window.supabase)return;
const sb=window.supabase.createClient(C.SB_URL,C.SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"vivant-auth"}});
window.vivantSB=sb;
// Connexion une seule fois par appareil : adresse e-mail et mot de passe (le premier essai crée le compte)
let userP=null;
const askReady=()=>new Promise(r=>{const t=()=>typeof window.ask==="function"?r():setTimeout(t,50);t();});
const askIn=(title,value,type,ac)=>{const p=window.ask(title,value);const i=document.querySelector(".ask input");if(i){i.type=type;i.autocomplete=ac;if(type==="email")i.inputMode="email";}return p;};
async function login(){await askReady();
  for(;;){const email=((await askIn("Adresse e-mail",localStorage.getItem("vivant-email")||"","email","username"))||"").trim();if(!email)continue;
    localStorage.setItem("vivant-email",email);
    const password=(await askIn("Mot de passe","","password","current-password"))||"";if(password.length<6)continue;
    let r=await sb.auth.signInWithPassword({email,password});if(!r.error&&r.data.user)return r.data.user;
    r=await sb.auth.signUp({email,password});if(!r.error&&r.data.session)return r.data.user;
    await window.ask("Mot de passe incorrect");}}
const user=()=>userP||(userP=sb.auth.getSession().then(({data})=>data.session?data.session.user:login()));
// Document unique de données (table state, une ligne par compte), avec mises à jour en direct entre téléphone et iPad
const snap=row=>({exists:!!row,data:()=>row&&row.data,metadata:{hasPendingWrites:false,fromCache:false}});
const docRef=uid=>({
  async get(){const {data,error}=await sb.from("state").select("data").eq("id",uid).maybeSingle();if(error)throw error;return snap(data);},
  async set(obj){const {error}=await sb.from("state").upsert({id:uid,data:obj,updated_at:new Date().toISOString()});if(error)throw error;},
  onSnapshot(cb,err){const ch=sb.channel("state-"+uid).on("postgres_changes",{event:"*",schema:"public",table:"state",filter:"id=eq."+uid},p=>{if(p.new&&p.new.data)cb(snap(p.new));})
    .subscribe(st=>{if(st==="CHANNEL_ERROR"||st==="TIMED_OUT")err&&err();});return ()=>sb.removeChannel(ch);}});
window.claude={use:async name=>{
  if(name==="user"){const u=await user();return {id:async()=>u.id};}
  if(name==="db")return {doc:p=>docRef(p.split("/")[2])};
  if(name==="downloads")return {save:async({filename,data})=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([data],{type:"application/json"}));a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);}};
  return null;}};
// Sonnerie écran verrouillé : notification envoyée par le serveur à la fin de chaque minuteur. À demander lors d'un toucher (exigence d'Apple).
const b64=s=>{const p="=".repeat((4-s.length%4)%4),r=atob((s+p).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from(r,c=>c.charCodeAt(0));};
window.vivantPush=async()=>{try{if(!("serviceWorker" in navigator)||!("PushManager" in window)||!window.Notification)return;
  const perm=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;if(perm!=="granted")return;
  const reg=await navigator.serviceWorker.ready;let s=await reg.pushManager.getSubscription();
  if(!s){const {data}=await sb.from("config").select("v").eq("k","vapid_public").maybeSingle();if(!data)return;
    s=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(data.v)});}
  const u=await user();await sb.from("push_subs").upsert({endpoint:s.endpoint,user_id:u.id,sub:s.toJSON()});}catch(e){}};
})();
