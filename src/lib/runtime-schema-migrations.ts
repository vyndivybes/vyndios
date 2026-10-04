import { pendingMigrations } from "../../scripts/migration-plan.mjs";

export type RuntimeMigrationTransportSource = "hyperdrive" | "database-url";

export type RuntimeMigrationPlan = {
  allowed:boolean;
  pending:Array<{name:string;path:string;sql:string}>;
  blocked:Array<{name:string;classes:string[]}>;
};

export function destructiveRuntimeMigrationStatements(sql:string):string[]{
  const normalized=String(sql)
    .replace(/--.*$/gm," ")
    .replace(/\/\*[\s\S]*?\*\//g," ")
    .toUpperCase();

  const classes:[string,RegExp][]=[
    ["DROP TABLE",/\bDROP\s+TABLE\b/],
    ["DROP COLUMN",/\bDROP\s+COLUMN\b/],
    ["TRUNCATE",/\bTRUNCATE\b/],
    ["DELETE WITHOUT WHERE",/\bDELETE\s+FROM\s+[A-Z0-9_."-]+\s*;/],
  ];
  return classes.filter(([,pattern])=>pattern.test(normalized)).map(([name])=>name);
}

export function planRuntimeSchemaMigrations(input:{
  transportSource:RuntimeMigrationTransportSource;
  migrations:Record<string,string>;
  applied:string[];
}):RuntimeMigrationPlan{
  if(input.transportSource!=="hyperdrive"){
    return {allowed:false,pending:[],blocked:[]};
  }

  const pending=pendingMigrations(Object.keys(input.migrations),input.applied);
  const blocked=pending.flatMap(({name,path})=>{
    const classes=destructiveRuntimeMigrationStatements(input.migrations[path]??"");
    return classes.length?[{name,classes}]:[];
  });
  if(blocked.length){
    return {allowed:false,pending:[],blocked};
  }

  return {
    allowed:true,
    pending:pending.map(({name,path})=>({name,path,sql:input.migrations[path]??""})),
    blocked:[],
  };
}

export function expectedRuntimeMigrationNames(migrations:Record<string,string>):string[]{
  return pendingMigrations(Object.keys(migrations),[]).map(({name})=>name);
}
