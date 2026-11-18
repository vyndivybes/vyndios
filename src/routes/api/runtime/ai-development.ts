import {createFileRoute} from '@tanstack/react-router';
import {requireBusinessActor} from '@/lib/business-actor';
import {handleAiDevelopmentRequest} from '@/lib/ai-development-http';
import {runDevelopmentProbe} from '../../../../vendor/ai-independence/development-probe.mjs';

export const Route=createFileRoute('/api/runtime/ai-development')({
 server:{handlers:{POST:async({request})=>handleAiDevelopmentRequest(request,{
  authorize:()=>requireBusinessActor('approve'),
  runProbe:async()=>{
   // No binding/secret/config is provisioned by this change. Missing prerequisites HOLD.
   const workersModule='cloudflare:workers';
   const workers=await import(/* @vite-ignore */ workersModule);
   return runDevelopmentProbe({env:workers.env,request:{confirm:true}});
  },
 })}},
});
