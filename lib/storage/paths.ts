import "server-only";
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { runtimeRoot } from "@/lib/config/runtime";

export function resolveStoredFile(filePath:string|null):string|null {
  if(!filePath || isAbsolute(filePath) || filePath.includes("\\") || filePath.includes(":") || filePath.split("/").some((part)=>!part||part===".."||part==="."))return null;
  try {
    const base=realpathSync(join(runtimeRoot(),"storage"));
    const candidate=resolve(base,filePath);
    if(!existsSync(candidate))return null;
    const actual=realpathSync(candidate);
    const inside=relative(base,actual);
    return inside!=="" && inside!==".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside) && statSync(actual).isFile() ? actual:null;
  } catch {return null;}
}
export function storedFileExists(filePath:string|null):boolean {return resolveStoredFile(filePath)!==null;}
