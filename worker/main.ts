import { openDatabase } from "../lib/db/connection";
import { verifyMigrations } from "../lib/db/migrate";
import { checkStartup } from "../lib/services/startup";
import { runNextJob } from "../lib/jobs/runner";
let stopped=false;process.on("SIGINT",()=>{stopped=true;});process.on("SIGTERM",()=>{stopped=true;});
const status=checkStartup();if(!status.canStart){console.error("작업 처리기를 시작하지 못했어요. 시작 점검을 확인해 주세요.");process.exit(1);}
const handle=openDatabase(undefined,{fileMustExist:true});
try {verifyMigrations(handle.sqlite);console.log("샘플 작업 처리기 시작 · 동시 작업 1개");while(!stopped){await runNextJob(handle);if(!stopped)await new Promise(resolve=>setTimeout(resolve,1000));}}
catch {console.error("작업 처리기가 중단됐어요. 시작 점검과 저장 공간을 확인해 주세요.");process.exitCode=1;}
finally{handle.close();}
