'use strict';
const {KEYS}=require('../core/analysis.cjs');
function fixture(n=12,id='90001'){
  const teams=Array.from({length:n},(_,i)=>({id:String(i+1),name:`示例队 ${i+1}`,stats:{'FGM/A':`${100+i}/${220+i*3}`,'FTM/A':`${40+i}/${55+i*2}`,'FG%':'.450','FT%':'.800','3PTM':String(15+i%5),PTS:String(200+i*7),OREB:String(20+i%4),REB:String(70+i*2),AST:String(50+i*3),ST:String(15+i%3),BLK:String(9+i%5),TO:String(20+i%4),'A/T':'2.5',GP:String(20+i%3)}}));
  const players=Array.from({length:14},(_,i)=>({id:String(1001+i),name:`示例球员 ${i+1}`,position:i<3?'PG':i<6?'SG':i<9?'SF':i<12?'PF':'C',eligible:i<6?'PG,SG':i<12?'SF,PF':'C',info:`示例球员 ${i+1} PHI - ${i<6?'PG,SG':'SF,PF'} 7:30 pm vs MIL`,stats:{'FGM/A':`${4+i*.3}/${10+i*.5}`,'FTM/A':`${2+i*.2}/${3+i*.2}`,'FG%':String(.4+i*.005),'FT%':String(.7+i*.006),'3PTM':String(1+i*.1),PTS:String(10+i),OREB:String(1+i*.1),REB:String(3+i*.2),AST:String(2+i*.3),ST:String(.5+i*.1),BLK:String(.2+i*.1),TO:String(1+i*.1),'A/T':'2.5',GP:'5'}}));
  return {league:'示例联盟',leagueID:id,teamID:'1',week:'Week 1',receivedAt:new Date().toISOString(),columns:KEYS,teams:teams.slice(0,2),players,source:`https://basketball.fantasysports.yahoo.com/nba/${id}/matchup?date=totals`,syncScope:'full',research:{recent:players,season:players,seasonLabel:'本赛季',available:[],prior:[],baselineIDs:players.map(p=>p.id),updatedAt:new Date().toISOString()},leaguePower:{teams,week:'Week 1',updatedAt:new Date().toISOString(),expectedTeamCount:n,matchupPairs:Array.from({length:Math.floor(n/2)},(_,i)=>[String(i*2+1),String(i*2+2)]),priorWeeks:[]}};
}
module.exports={fixture};
if(require.main===module)process.stdout.write(JSON.stringify({leagues:[{id:'90001',team:'1',name:'演示联盟',theme:'white'}],snapshots:[fixture()]}));
