export type Capability="text"|"image"|"video"|"speech"|"dialogue"|"music"|"transcribe"|"lipsync"|"motion";
export interface GenerationRequest {capability:Capability;model:string;prompt?:string;refAssets?:{assetId:string;role:"character"|"start_frame"|"end_frame"|"style"|"audio"|"motion"}[];params:Record<string,unknown>}
export interface Usage {costMicros?:number;currency?:string}
export type ProviderOutput={type:"structured";data:unknown;usage?:Usage}|{type:"media";files:{url?:string;bytes?:Uint8Array;mime:string}[];usage?:Usage};
export type ProviderCode="CONTENT_REJECTED"|"INVALID_INPUT"|"RATE_LIMITED"|"PROVIDER_DOWN"|"TIMEOUT"|"AUTH"|"BUDGET_EXCEEDED"|"UNKNOWN";
export interface ProviderError {code:ProviderCode;message:string;retryable:boolean}
export class ProviderFailure extends Error implements ProviderError {constructor(public code:ProviderCode,message:string,public retryable=false){super(message);}}
export interface Provider {id:string;capabilities:Capability[];estimateCost(req:GenerationRequest):{micros:number;currency:string};submit(req:GenerationRequest,key:string):Promise<{providerJobId?:string;output?:ProviderOutput}>;poll(id:string):Promise<{state:"pending"|"succeeded"|"failed"|"canceled";output?:ProviderOutput;error?:ProviderError}>;cancel?(id:string):Promise<void>}
