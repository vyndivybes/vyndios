export function runDevelopmentProbe(options:{env:Record<string,unknown>;request:{confirm:true};now?:number;fetchImpl?:typeof fetch}):Promise<{status:string;actionAuthorized:false;accepted?:boolean}>;
