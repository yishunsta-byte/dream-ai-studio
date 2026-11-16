// P2-4b render child boundaries that need no Remotion (T-116 F116-4). No side effects on import: the child calls
// installNetGuard() itself, tests import the pure parts.
// - Node: every net.Socket connect (all overloads, including the normalized array form net.connect() passes on) must
//   name a loopback host; a name is checked again after its DNS lookup. This is an in-process check, not an OS
//   firewall: native code (the compositor) and the browser are bounded separately (owned URLs, browser flags).
// - Props: every media/font URL must be exactly this attempt's file server (origin + token + /m|f/{index}). Nothing
//   else reaches the browser or the native compositor, so no other origin and no redirect target can be fetched.
import net from "node:net";
import type { RenderProps } from "../lib/render/props";
import { storageFailure } from "../lib/render/errors";

export class NetworkRefused extends Error{constructor(target:string){super(`RENDER_NETWORK_REFUSED: ${target}`);this.name="NetworkRefused";}}
export function loopbackAddress(address:string){
  const value=address.replace(/^\[|\]$/g,"").toLowerCase();
  return value==="::1"||/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)||/^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
}
const loopbackHost=(host:string)=>host.toLowerCase()==="localhost"||loopbackAddress(host);

type Target={host?:unknown;path?:unknown;port?:unknown};
// The connect overloads: (options[, cb]), (port[, host][, cb]), (path[, cb]) and the internal normalized form
// ([options, cb]) that net.connect()/createConnection() pass to Socket#connect.
export function connectTarget(args:unknown[]):Target{
  const first=Array.isArray(args[0])?args[0][0]:args[0];
  if(typeof first==="object"&&first!==null)return first as Target;
  if(typeof first==="string"&&!/^\d+$/.test(first))return {path:first};
  return {port:first,host:typeof args[1]==="string"?args[1]:undefined};
}
let installed=false;
export function installNetGuard(){
  if(installed)return;installed=true;
  const connect=net.Socket.prototype.connect;
  net.Socket.prototype.connect=function(this:net.Socket,...args:unknown[]){
    const target=connectTarget(args);
    if(target.path!==undefined&&target.path!==null){
      // local IPC only (a pipe/socket path), never a URL-like or host-like string
      if(typeof target.path!=="string"||/:\/\//.test(target.path))throw new NetworkRefused(String(target.path));
      return (connect as (...values:unknown[])=>net.Socket).apply(this,args);
    }
    // Node's own default for a missing host is localhost; it is checked like any other name.
    const host=target.host===undefined||target.host===null||target.host===""?"localhost":target.host;
    if(typeof host!=="string"||!loopbackHost(host))throw new NetworkRefused(String(host));
    // A name (even localhost) is checked again on the address it resolved to.
    if(net.isIP(host.replace(/^\[|\]$/g,""))===0){
      this.on("lookup",(error:Error|null,address:string|string[])=>{
        const addresses=Array.isArray(address)?address:[address];
        if(!error&&addresses.some(item=>typeof item==="string"&&!loopbackAddress(item)))this.destroy(new NetworkRefused(`${host} -> ${addresses.join(",")}`));
      });
    }
    return (connect as (...values:unknown[])=>net.Socket).apply(this,args);
  } as typeof net.Socket.prototype.connect;
}

// The attempt's file server base: http://127.0.0.1:{port}/{64 hex token}.
export function validFileBase(base:string){return /^http:\/\/127\.0\.0\.1:\d{1,5}\/[0-9a-f]{64}$/.test(base);}
export function ownedUrl(base:string,url:string,kind:"m"|"f"){
  if(!validFileBase(base)||typeof url!=="string")return false;
  const rest=url.startsWith(`${base}/`)?url.slice(base.length+1):null;
  return rest!==null&&new RegExp(`^${kind}/\\d{1,4}$`).test(rest);
}
// Every source the composition may load is one of this attempt's files; anything else stops the render first.
export function assertOwnedProps(props:RenderProps,base:string){
  if(!validFileBase(base))throw new NetworkRefused("file server base");
  for(const clip of props.clips)if(!ownedUrl(base,clip.src,"m"))throw new NetworkRefused(`clip ${clip.sceneId}`);
  for(const font of props.fonts)if(!ownedUrl(base,font.url,"f"))throw new NetworkRefused(`font ${font.family}`);
}

// The browser reaches only loopback: names other than localhost fail to resolve, and anything not bypassed goes to a
// closed loopback proxy (so an IP address cannot slip past the resolver rule either).
export const chromiumFlags=(netLog:string|null):Record<string,string|boolean>=>({"host-resolver-rules":"MAP localhost 127.0.0.1 , MAP * ~NOTFOUND , EXCLUDE 127.0.0.1","proxy-server":"http://127.0.0.1:9","proxy-bypass-list":"<-loopback>;127.0.0.1;localhost",...(netLog?{"log-net-log":netLog,"net-log-capture-mode":"Default"}:{})});

// Error → code. Kept to the reasons the worker may act on; the detail is a short first line for its log only.
export function classify(error:unknown):{code:string;detail:string}{
  const message=String((error as {message?:unknown})?.message??error),first=message.split("\n")[0].slice(0,300),code=(error as {code?:unknown})?.code;
  if(/got cancelled|cancelled|canceled/i.test(message))return {code:"RENDER_CANCELED",detail:first};
  const font=/FONT_MISSING:([^\n]*)/.exec(message);if(font)return {code:"FONT_MISSING",detail:font[1].slice(0,80)};
  if(/ENOSPC|no space left/i.test(message))return {code:"DISK_FULL",detail:first};
  // system errors: the same storage rule as the worker (lib/render/errors storageFailure)
  const errno=typeof code==="string"&&/^E[A-Z0-9]+$/.test(code)?code:null;
  if(errno){const kind=storageFailure(errno);if(kind.code==="DISK_FULL"||kind.retryable)return {code:kind.code,detail:first};}
  if(/RENDER_BROWSER_MISSING/.test(message))return {code:"RENDER_BROWSER_MISSING",detail:first};
  if(/RENDER_NETWORK_REFUSED/.test(message))return {code:"RENDER_FAILED",detail:first};
  if(/Compositor (exited|quit)|Target closed|Browser (closed|has disconnected)|crash|Protocol error|Session closed|ECONNRESET|socket hang up|Navigation failed because browser has disconnected/i.test(message))return {code:"RENDER_BROWSER_CRASHED",detail:first};
  return {code:"RENDER_FAILED",detail:first};
}
