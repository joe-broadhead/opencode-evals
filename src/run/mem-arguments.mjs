// Resolution is not parse success. Never execute source text or infer arguments from an answer.
import {readLiteral,extractInnerCalls} from "../trace/innerArgs.mjs"
export function resolvedMemoryArgs(v){
  if(v===null||typeof v==="string"||typeof v==="boolean")return true
  if(typeof v==="number")return Number.isFinite(v)
  if(Array.isArray(v))return v.every(resolvedMemoryArgs)
  return Boolean(v&&typeof v==="object"&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Object.entries(v).every(([k,x])=>!k.startsWith("$")&&resolvedMemoryArgs(x)))
}
function skip(code,i){
  const q=code[i]
  if(['"',"'","`"].includes(q)){for(let j=i+1;j<code.length;j++){if(code[j]==="\\")j++;else if(code[j]===q)return j+1}return code.length}
  if(code.slice(i,i+2)==="//"){const n=code.indexOf("\n",i+2);return n<0?code.length:n+1}
  if(code.slice(i,i+2)==="/*"){const n=code.indexOf("*/",i+2);return n<0?code.length:n+2}
  return i
}
export function closedMemorySites(code){
  if(typeof code!=="string")return []
  const out=[]
  for(let i=0;i<code.length;){
    const next=skip(code,i);if(next!==i){i=next;continue}
    const m=code.slice(i).match(/^tools(?:\.[A-Za-z_$][\w$]*|\[["'][^"']+["']\])+\s*\(/)
    if(!m||i>0&&/[\w$.]/.test(code[i-1])){i++;continue}
    const open=i+m[0].length-1;let depth=1,end=open+1
    for(;end<code.length;end++){const n=skip(code,end);if(n!==end){end=n-1;continue}if(code[end]==="(")depth++;if(code[end]===")"&&--depth===0)break}
    const raw=code.slice(open+1,end),site=extractInnerCalls(`${m[0]}${raw})`)[0]
    if(site){const literal=raw.trim().startsWith("{")&&!raw.includes("${")?readLiteral(raw):{ok:false};out.push({...site,args:literal.ok?literal.value:undefined,parsed:Boolean(depth===0&&literal.ok&&resolvedMemoryArgs(literal.value))})}
    i=end+1
  }
  return out
}
