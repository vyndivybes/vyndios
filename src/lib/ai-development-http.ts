type Dependencies={authorize:()=>Promise<unknown>;runProbe:()=>Promise<{status:string;actionAuthorized?:false;accepted?:boolean}>};
export async function handleAiDevelopmentRequest(request:Request,deps:Dependencies):Promise<Response> {
 const json=(data:unknown,status:number)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 try{await deps.authorize();}catch{return json({error:'AUTHORIZATION_REQUIRED'},403);}
 if(request.headers.get('origin')!==new URL(request.url).origin)return json({error:'ORIGIN_DENIED'},403);
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))return json({error:'JSON_REQUIRED'},415);
 // Bound reads before JSON parsing; no arbitrary text reaches the provider.
 const reader=request.body?.getReader();let text='';
 if(!reader)return json({error:'SYNTHETIC_FIXTURE_ONLY'},422);
 try{
  const decoder=new TextDecoder();let bytes=0;
  while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>128){await reader.cancel();return json({error:'INPUT_TOO_LARGE'},413);}text+=decoder.decode(chunk.value,{stream:true});}
  text+=decoder.decode();
  const body=JSON.parse(text);
  if(!body||Object.keys(body).sort().join(',')!=='confirm'||body.confirm!==true)return json({error:'SYNTHETIC_FIXTURE_ONLY'},422);
 }catch{return json({error:'SYNTHETIC_FIXTURE_ONLY'},422);}
 try{const data=await deps.runProbe();return json({data},data.status==='OK'?200:409);}
 catch{return json({error:'DEVELOPMENT_PROBE_UNAVAILABLE'},503);}
}
