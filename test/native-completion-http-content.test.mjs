import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCompletionReadClient} from '../src/run/native-completion-http.mjs';

const tool=state=>({type:'tool',id:'call',name:'tool',time:{created:1},state});
const state=(status,content)=>({status,input:{},content,...(status==='error'?{error:{type:'example',message:'failed'}}:{})});
async function read(content,invalid=false) {
  const page={data:[{id:'msg_a',type:'assistant',time:{created:1},agent:'a',model:{id:'m',providerID:'p'},content}],cursor:{}};
  const body=new ReadableStream({start(controller){controller.enqueue(Buffer.from(JSON.stringify(page)));controller.close();}});
  let released=0,tracked=0;
  const client=makeCompletionReadClient({
    endpointLease:{origin:'http://127.0.0.1:43129',authorization:'Basic b3BlbmNvZGU6dGVzdA==',
      signal:new AbortController().signal,incarnationID:'inc',sessionIDs:['ses_A']},
    binding:{incarnationID:'inc',sessionID:'ses_A',scope:{complete:true,serial:true,sessionIDs:['ses_A']}},
    fetchImpl:async()=>({status:200,headers:new Headers({'content-type':'application/json'}),body}),
    transportOwner:{track(){tracked++;return()=>released++;}},
  });
  try {
    const result=client.message.list({sessionID:'ses_A',limit:200,order:'desc'});
    if(invalid) await assert.rejects(result,{name:'Error',message:'invalid_wire_shape'});
    else assert.deepEqual(await result,page);
  } finally {
    assert.equal(tracked,1);assert.equal(released,1);assert.equal(body.locked,false);
  }
}

test('null, primitive and array tool-content items use the bounded shape error after exact cleanup',async()=>{
  for(const status of ['completed','error']) {
    for(const item of [null,false,0,'text',[],[null]])
      await read([tool(state(status,[{type:'text',text:'valid prefix'},item]))],true);
    for(const content of [null,false,0,'text',[]]) await read([tool(state(status,content))],true);
  }
});

test('adjacent assistant-part and tool-state discriminators guard JSON null, primitives and arrays',async()=>{
  for(const value of [null,false,0,'text',[],[null]]) {
    await read([value],true);
    await read([tool(value)],true);
  }
});

test('valid text and file content retain their values in completed and error tool states',async()=>{
  const content=[{type:'text',text:'result 😀'},{type:'file',uri:'native:opaque',mime:'text/plain'},
    {type:'file',uri:'native:other',mime:'application/octet-stream',name:null}];
  for(const status of ['completed','error']) await read([
    {type:'text',text:'answer',native:{opaque:[null]}},
    {type:'reasoning',text:'reason',time:{created:1}},tool(state(status,content)),
  ]);
});
