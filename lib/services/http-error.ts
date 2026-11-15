import { ZodError } from "zod";
import { MediaError } from "@/lib/media/inspect";
export function mediaErrorResponse(error:unknown) {
 if(error instanceof MediaError)return Response.json({error:error.message,code:error.code},{status:error.status});
 if(error instanceof ZodError||error instanceof SyntaxError)return Response.json({error:"필수 항목과 입력 형식을 확인해 주세요.",code:"INVALID_INPUT"},{status:400});
 return Response.json({error:"작업을 완료하지 못했어요. 시작 점검과 저장 상태를 확인해 주세요.",code:"STORAGE_FAILED"},{status:503});
}
