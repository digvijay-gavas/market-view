// Public client ID and per-folder display selections only. Credentials never use localStorage.
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id);
const key='marketView.oauthClientId';
export function restoreClientId(storage){try{const id=(storage??globalThis.localStorage).getItem(key);return valid(id)?id:'';}catch{return '';}}
export function saveClientId(id,storage){try{const target=storage??globalThis.localStorage;if(!id)target.removeItem(key);else if(valid(id))target.setItem(key,id);}catch{/* Browser storage may be disabled. The current session still works. */}}

const selectionKey=(client,root)=>'marketView.accounts:'+client+':'+root;
export function normalizeSelection(value){return value===null?null:Array.isArray(value)&&value.every(x=>typeof x==='string'&&/^[a-z0-9_-]+$/.test(x))?[...new Set(value)].sort():null;}
export function restoreSelection(client,root,storage){try{return normalizeSelection(JSON.parse((storage??globalThis.localStorage).getItem(selectionKey(client,root))||'null'));}catch{return null;}}
export function saveSelection(client,root,value,storage){try{(storage??globalThis.localStorage).setItem(selectionKey(client,root),JSON.stringify(normalizeSelection(value)));return true;}catch{return false;}}
