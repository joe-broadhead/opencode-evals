// Independent HTTP receipt + durable readback. A 200, a promise, or an empty forget is not storage.
export function baselineEffect(path,input,response,before,after,space) {
  const method=path.split("/").pop(),payload=response.json?.data??response.json
  const name=method==="records.revise"&&input.action==="forget"?"records.forget":path.endsWith("/wiki/raw/write")?"wiki.raw.write":method
  if(!["records.put","records.revise","records.append","records.delete","records.forget","wiki.raw.write"].includes(name))return null
  const ids=input.ids??(input.id?[input.id]:[])
  const result={method:name,space,status:"partial",...(payload?.record?{record:payload.record}:{}),...(ids.length===1?{id:ids[0]}:{})}
  if(response.status<200||response.status>=300||response.json?.error||response.json?.code)return {...result,status:"denied"}
  if(["queued","denied","partial","unsupported","processing"].includes(payload?.status))return {...result,status:payload.status}
  let stored=false
  if(name==="records.put")stored=Boolean(payload?.record?.id&&(after.records??[]).some((r)=>r.id===payload.record.id&&r.body===input.record?.body))
  else if(name==="records.forget"||name==="records.delete")stored=Boolean(ids.length&&ids.every((id)=>(before.records??[]).some((r)=>r.id===id)&&!(after.records??[]).some((r)=>r.id===id)))
  else if(name==="wiki.raw.write") {
    const wiki=(after.knowledge??[]).find((w)=>w.knowledge_id===input.wiki_id)
    stored=Boolean(input.files?.length&&input.files.every((f)=>wiki?.raw?.[f.filename]===f.content&&(payload?.items??[]).some((i)=>i.filename===f.filename&&i.status==="written")))
  } else stored=Boolean(payload?.record?.id&&JSON.stringify(before.records)!==JSON.stringify(after.records)&&(after.records??[]).some((r)=>r.id===payload.record.id))
  return {...result,status:stored?"stored":"partial"}
}
