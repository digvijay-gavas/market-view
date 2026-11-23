import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
const exec=promisify(execFile);
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function taskXML({user,node,repo,home,date=new Date().toISOString().slice(0,10)}){
 const args='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+join(repo,'automation','task-entry.ps1')+'" -NodePath "'+node+'" -CollectorHome "'+home+'"';
 return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>Market-view progressive collector: daily positions and shared prices around every ten minutes during NSE market hours.</Description></RegistrationInfo><Triggers><CalendarTrigger><Repetition><Interval>PT1M</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>${date}T00:00:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers><Principals><Principal id="Author"><UserId>${xml(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT25M</ExecutionTimeLimit><Enabled>true</Enabled></Settings><Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>${xml(args)}</Arguments><WorkingDirectory>${xml(repo)}</WorkingDirectory></Exec></Actions></Task>`;
}
export async function installTask(home){
 if(process.platform!=='win32')throw new Error('Windows Task Scheduler is required.');
 const user=(await exec('whoami.exe',[],{windowsHide:true})).stdout.trim(),repo=fileURLToPath(new URL('../',import.meta.url));
 const path=join(home,'scheduled-task.xml');await writeFile(path,'\ufeff'+taskXML({user,node:process.execPath,repo,home}),{encoding:'utf16le',mode:0o600});
 await exec('schtasks.exe',['/Create','/TN','MarketView Progressive Collector','/XML',path,'/F'],{windowsHide:true});return 'MarketView Progressive Collector';
}
export async function taskInstalled(){
 if(process.platform!=='win32')return false;
 try{await exec('schtasks.exe',['/Query','/TN','MarketView Progressive Collector','/FO','CSV','/NH'],{windowsHide:true});return true;}catch{return false;}
}
