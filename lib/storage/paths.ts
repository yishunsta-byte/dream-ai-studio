import "server-only";
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export function storedFileExists(filePath:string|null):boolean {
  if(!filePath || isAbsolute(filePath) || filePath.includes("\\") || filePath.includes(":") || filePath.split("/").some((part)=>!part||part===".."||part==="."))return false;
  try {
    const base=realpathSync(join(process.cwd(),"storage"));
    const candidate=resolve(base,filePath);
    if(!existsSync(candidate))return false;
    const actual=realpathSync(candidate);
    const inside=relative(base,actual);
    return inside!=="" && inside!==".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside) && statSync(actual).isFile();
  } catch {return false;}
}
