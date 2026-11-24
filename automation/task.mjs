import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
const exec=promisify(execFile);
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const TASK_NAME='MarketView Progressive Collector';
const hhmm=value=>{const m=/^(\d{2}):(\d{2})$/.exec(value||'');if(!m||+m[1]>23||+m[2]>59)throw new Error('INVALID_COLLECTION_WINDOW');return +m[1]*60+ +m[2];};
// The trigger only repeats inside the collection window; the worker still checks holidays and due time.
export function taskXML({user,node,repo,home,date=new Date().toISOString().slice(0,10),open='09:15',close='15:30'}){
 const start=hhmm(open),minutes=hhmm(close)-start;if(minutes<=0)throw new Error('INVALID_COLLECTION_WINDOW');
 // conhost --headless runs the console without ever showing a window (powershell -WindowStyle Hidden still flashes one).
 const args='--headless powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File "'+join(repo,'automation','task-entry.ps1')+'" -NodePath "'+node+'" -CollectorHome "'+home+'"';
 return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>Market-view progressive collector: daily positions and optional shared prices inside the configured collection window.</Description></RegistrationInfo><Triggers><CalendarTrigger><Repetition><Interval>PT1M</Interval><Duration>PT${minutes}M</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>${date}T${open}:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers><Principals><Principal id="Author"><UserId>${xml(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT25M</ExecutionTimeLimit><Enabled>true</Enabled></Settings><Actions Context="Author"><Exec><Command>conhost.exe</Command><Arguments>${xml(args)}</Arguments><WorkingDirectory>${xml(repo)}</WorkingDirectory></Exec></Actions></Task>`;
}
export async function installTask(home,schedule={}){
 if(process.platform!=='win32')throw new Error('Windows Task Scheduler is required.');
 const user=(await exec('whoami.exe',[],{windowsHide:true})).stdout.trim(),repo=fileURLToPath(new URL('../',import.meta.url));
 const path=join(home,'scheduled-task.xml');await writeFile(path,'\ufeff'+taskXML({user,node:process.execPath,repo,home,open:schedule.open,close:schedule.close}),{encoding:'utf16le',mode:0o600});
 await exec('schtasks.exe',['/Create','/TN',TASK_NAME,'/XML',path,'/F'],{windowsHide:true});return TASK_NAME;
}
export async function taskInstalled(){
 if(process.platform!=='win32')return false;
 try{await exec('schtasks.exe',['/Query','/TN',TASK_NAME,'/FO','CSV','/NH'],{windowsHide:true});return true;}catch{return false;}
}
// Pausing must stop Windows from launching the task at all, not just make each launch exit early.
export async function setTaskEnabled(enabled){
 if(process.platform!=='win32'||!await taskInstalled())return false;
 await exec('schtasks.exe',['/Change','/TN',TASK_NAME,enabled?'/ENABLE':'/DISABLE'],{windowsHide:true});return true;
}
