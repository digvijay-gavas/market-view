const encode=bytes=>btoa(String.fromCharCode(...bytes));
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const clientPattern=/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
async function derive(pin,salt,iterations,usage){
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},material,{name:'AES-GCM',length:256},false,[usage]);
}
export async function encryptClientId(clientId,pin){
 if(!clientPattern.test(clientId)||!/^\d{4,12}$/.test(pin))throw new Error('Use a valid web client ID and a 4–12 digit PIN.');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),iterations=600000;
 const key=await derive(pin,salt,iterations,'encrypt');
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(clientId));
 return {version:1,iterations,salt:encode(salt),iv:encode(iv),ciphertext:encode(new Uint8Array(ciphertext))};
}
export async function decryptClientId(config,pin){
 try{
  if(config?.version!==1||config.iterations!==600000||!/^\d{4,12}$/.test(pin))throw new Error();
  const salt=decode(config.salt),iv=decode(config.iv);if(salt.length!==16||iv.length!==12)throw new Error();
  const key=await derive(pin,salt,config.iterations,'decrypt');
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,decode(config.ciphertext));
  const value=new TextDecoder().decode(plaintext);if(!clientPattern.test(value))throw new Error();return value;
 }catch{throw new Error('PIN could not unlock this app. Check the PIN and try again.');}
}
// Remembered unlock: after a correct PIN, the unlocked client ID (never the PIN) is kept in
// localStorage until 10 minutes pass without activity, so a reload does not ask again.
const UNLOCK_KEY='marketView.unlock';
export const UNLOCK_IDLE_MS=10*60000;
export function rememberUnlock(clientId,{storage=globalThis.localStorage,now=Date.now()}={}){
 if(!clientPattern.test(clientId))return false;
 try{storage.setItem(UNLOCK_KEY,JSON.stringify({version:1,clientId,until:now+UNLOCK_IDLE_MS}));return true;}catch{return false;}
}
export function restoreUnlock({storage=globalThis.localStorage,now=Date.now()}={}){
 try{
  const r=JSON.parse(storage.getItem(UNLOCK_KEY)||'null');
  if(r?.version===1&&clientPattern.test(r.clientId)&&Number.isFinite(r.until)&&r.until>now&&r.until<=now+UNLOCK_IDLE_MS)return r.clientId;
 }catch{}
 forgetUnlock({storage});return null;
}
// Activity extends the window; an expired record is not revived.
export function touchUnlock({storage=globalThis.localStorage,now=Date.now()}={}){
 const clientId=restoreUnlock({storage,now});return clientId?rememberUnlock(clientId,{storage,now}):false;
}
export function forgetUnlock({storage=globalThis.localStorage}={}){try{storage.removeItem(UNLOCK_KEY);}catch{}}
