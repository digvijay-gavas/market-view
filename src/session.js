// A short-lived Google session is scoped to this browser tab, not localStorage.
// Portfolio rows and refresh tokens are never stored.
const key='marketView.driveSession';
const clientPattern=/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
function valid(session,clientId,now){return session?.version===1&&session.clientId===clientId&&clientPattern.test(clientId)&&typeof session.accessToken==='string'&&session.accessToken.length>0&&session.accessToken.length<=8192&&Number.isFinite(session.expiresAt)&&session.expiresAt>now+10000&&session.expiresAt<=now+86400000&&(session.rootId===''||typeof session.rootId==='string'&&/^[A-Za-z0-9_-]+$/.test(session.rootId));}
export function clearSession(storage){try{(storage??globalThis.sessionStorage).removeItem(key);}catch{}}
export function restoreSession(clientId,{storage,now=Date.now()}={}){
 try{const session=JSON.parse((storage??globalThis.sessionStorage).getItem(key)||'null');if(valid(session,clientId,now))return session;}catch{}
 clearSession(storage);return null;
}
export function saveSession(session,{storage,now=Date.now()}={}){
 const record={version:1,clientId:session.clientId,accessToken:session.accessToken,expiresAt:session.expiresAt,rootId:session.rootId||'',...(typeof session.cacheScope==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(session.cacheScope)?{cacheScope:session.cacheScope}:{})};
 if(!valid(record,session.clientId,now)){clearSession(storage);return false;}
 try{(storage??globalThis.sessionStorage).setItem(key,JSON.stringify(record));return true;}catch{return false;}
}
