// Persist only the public OAuth client ID. Tokens and portfolio data never use storage.
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id);
const key='marketView.oauthClientId';
export function restoreClientId(storage){try{const id=(storage??globalThis.localStorage).getItem(key);return valid(id)?id:'';}catch{return '';}}
export function saveClientId(id,storage){try{const target=storage??globalThis.localStorage;if(!id)target.removeItem(key);else if(valid(id))target.setItem(key,id);}catch{/* Browser storage may be disabled. The current session still works. */}}
