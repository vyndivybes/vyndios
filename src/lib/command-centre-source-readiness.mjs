import {isInventoryVentureSourceHold} from './procurement-source-readiness.mjs';

/**
 * Guard only the known, independently detected mixed-venture inventory scope.
 * Preserve real authentication, schema, network and authorization failures.
 *
 * A source HOLD is not an empty/zero-result assertion; caller must display
 * explicit unavailable values for every lineage-dependent control/KPI.
 *
 * @template T
 * @param {() => Promise<T[]>} readLineage
 * @returns {Promise<{rows:T[],sourceHold:boolean}>}
 */
export async function readCommandLineage(readLineage){
 try{
  return {rows:await readLineage(),sourceHold:false};
 }catch(error){
  if(!isInventoryVentureSourceHold(error))throw error;
  return {rows:[],sourceHold:true};
 }
}
