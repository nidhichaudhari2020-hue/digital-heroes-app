export type PrizeAllocation={five:number;four:number;three:number;nextJackpot:number};
export function simulateDraw(): number[]{const pool=new Set<number>();while(pool.size<5)pool.add(Math.floor(Math.random()*45)+1);return [...pool].sort((a,b)=>a-b)}
export function calculatePrizes(pool:number,jackpot:number,winners:{five:number;four:number;three:number}):PrizeAllocation{
  const fivePool=pool*.4+jackpot; return {five:winners.five?fivePool/winners.five:0,four:winners.four?pool*.35/winners.four:0,three:winners.three?pool*.25/winners.three:0,nextJackpot:winners.five?0:fivePool};
}
export function countMatches(entry:number[], winning:number[]):number{return entry.filter(n=>winning.includes(n)).length}
