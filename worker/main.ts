import { openDatabase } from "../lib/db/connection";
import { verifyMigrations } from "../lib/db/migrate";
import { checkStartup } from "../lib/services/startup";
import { runNextJob } from "../lib/jobs/runner";
import { backupService } from "../lib/services/backups";
import { cleanStaleRenderTemps } from "../lib/jobs/render";
let stopped=false;process.on("SIGINT",()=>{stopped=true;});process.on("SIGTERM",()=>{stopped=true;});
const status=checkStartup();if(!status.canStart){console.error("작업 처리기를 시작하지 못했어요. 시작 점검을 확인해 주세요.");process.exit(1);}
const handle=openDatabase(undefined,{fileMustExist:true});
try {verifyMigrations(handle.sqlite);console.log("샘플 작업 처리기 시작 · 동시 작업 1개");
 // P2-4b: render work folders of attempts that are not running (crash, power loss) are removed; what is left is reported.
 const left=await cleanStaleRenderTemps(handle).catch(()=>["storage/tmp"]);if(left.length)console.error(`임시 파일을 정리하지 못했어요: ${left.length}개`);while(!stopped){if(!checkStartup().canStart)throw new Error("Startup check failed");backupService(handle).enqueueAuto();await runNextJob(handle);if(!stopped)await new Promise(resolve=>setTimeout(resolve,1000));}}
catch {console.error("작업 처리기가 중단됐어요. 시작 점검과 저장 공간을 확인해 주세요.");process.exitCode=1;}
finally{handle.close();}
