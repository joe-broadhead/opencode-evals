// Only three loopback modules created by our contained entry may receive traffic.
export function baselineRoute(method,path) {
  if(!["GET","POST","DELETE","PATCH"].includes(method)||typeof path!=="string"||!/^\/[A-Za-z0-9_./?=&%-]+$/.test(path)||path.includes("..")||path.includes("%")||path.startsWith("//"))return null
  if(/^\/v1\/(?:spaces|context|grants|resources)(?:[/?]|$)/.test(path))return {upstream:"control",path}
  if(method==="POST"&&/^\/records\/v1\/[a-z]+\.[A-Za-z]+$/.test(path))return {upstream:"control",path}
  if(method==="POST"&&/^\/(core|knowledge)\/v3\/[A-Za-z0-9_/-]+$/.test(path))return {upstream:"stub",path:path.replace(/^\/(core|knowledge)/,"")}
  if(method==="POST"&&/^\/core\/records\/v1\/[a-z]+\.[A-Za-z]+$/.test(path))return {upstream:"stub",path:path.slice(5)}
  return null
}
export function baselineScopeHeaders(plan,headers,input) {
  if(headers.authorization!=="Bearer eval-token")throw new Error("synthetic credential required")
  const permittedSpaces=plan.mode==="control"?["eval-space-personal","eval-space-shared"]:["local"]
  const permittedContainers=plan.mode==="control"?["eval-container-personal","eval-container-shared"]:["local"]
  if(headers["x-mem-space-id"]&&!permittedSpaces.includes(headers["x-mem-space-id"]))throw new Error("foreign scope")
  if(input.team_id&&!permittedContainers.includes(input.team_id))throw new Error("foreign container")
  if(input.user_id&&input.user_id!=="eval")throw new Error("foreign user")
  const selected={"content-type":"application/json",authorization:"Bearer eval-token"}
  for(const k of ["x-mem-space-id","x-tdai-agent-id","x-tdai-session-id","x-mem-tz"])if(headers[k])selected[k]=headers[k]
  selected["x-tdai-user-id"]="eval"
  return selected
}
