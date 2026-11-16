// K-6 compatibility outcomes that must reach the screen with their own code (not the generic RESTORE_INVALID).
export type BackupCompatCode="BACKUP_TOO_NEW"|"BACKUP_SCHEMA_MISMATCH"|"BACKUP_UPGRADE_FAILED"|"BACKUP_SOURCE_CHANGED";
export class BackupCompatError extends Error{constructor(readonly code:BackupCompatCode){super(code);this.name="BackupCompatError";}}
export const backupCompatCopy:Record<BackupCompatCode,{message:string;status:number}>={
 BACKUP_TOO_NEW:{message:"더 새 버전의 앱에서 만든 백업이에요. 앱을 업데이트한 뒤 복원해 주세요.",status:409},
 BACKUP_SCHEMA_MISMATCH:{message:"백업의 데이터 구조 기록이 이 앱과 맞지 않아요. 이 백업은 복원할 수 없어요.",status:409},
 BACKUP_UPGRADE_FAILED:{message:"이전 백업을 지금 구조로 바꾸지 못했어요. 원래 백업 파일과 지금 데이터는 그대로예요.",status:409},
 BACKUP_SOURCE_CHANGED:{message:"검사한 뒤에 원래 백업 파일이 바뀌었어요. 목적지와 지금 데이터는 그대로예요. 다시 검사해 주세요.",status:409},
};
