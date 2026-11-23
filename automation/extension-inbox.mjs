import {ist} from './schedule.mjs';
import {validateProgressive} from '../src/progressive.js';
export function extensionCapture(secret,now=new Date()){
 const fail=code=>{throw Object.assign(new Error(code),{code});};
 if(!secret?.extension?.confirmed)fail('EXTENSION_NOT_PAIRED');const capture=secret.extension.capture;
 if(!capture||!Number.isFinite(Date.parse(capture.capturedAt))||Date.parse(capture.capturedAt)>+now+300000||ist(new Date(capture.capturedAt)).day!==ist(now).day)fail('EXTENSION_CAPTURE_REQUIRED');
 validateProgressive({dataset:'portfolio.positions',tables:{positions:capture.rows}});return {rows:capture.rows,capturedAt:capture.capturedAt};
}
