(function(root){
  'use strict';
  class SyncCoordinator {
    constructor(saved={}){
      this.leases=saved.leases||{};this.lastAuto=saved.lastAuto||{};
      this.daily=saved.daily||{};this.job=saved.job||null;this.sequence=saved.sequence||0;
    }
    observe(command,leagues){
      if(!command?.requestID){this.job=null;return;}
      if(this.job?.requestID===command.requestID)return;
      this.job={requestID:command.requestID,ids:leagues.filter(l=>!command.leagueID||l.id===command.leagueID).map(l=>l.id),results:{}};
    }
    acquire(id,tab,options={},now=Date.now()){
      const previous=this.leases[id],job=this.job;
      if(previous&&now-previous.time<90000)return null;
      if(options.requestID){
        if(job?.requestID!==options.requestID||!job.ids.includes(id)||job.results[id])return null;
      } else {
        if(job?.ids.includes(id)&&!job.results[id])return null;
        if(options.todayOnly&&now-(this.lastAuto[id]||0)<9.5*60000)return null;
        if(options.daily&&(!options.day||this.daily[id]===options.day))return null;
      }
      const lease={tab,time:now,leaseID:String(now)+'-'+(++this.sequence),requestID:options.requestID||null,todayOnly:!!options.todayOnly,day:options.daily?options.day:null};
      if(lease.day)this.daily[id]=lease.day;
      this.leases[id]=lease;return lease;
    }
    owns(id,tab,leaseID){const l=this.leases[id];return !!l&&l.tab===tab&&l.leaseID===leaseID;}
    heartbeat(id,tab,leaseID,now=Date.now()){if(!this.owns(id,tab,leaseID))return false;this.leases[id].time=now;return true;}
    finish(id,tab,leaseID,error='',now=Date.now()){
      if(!this.owns(id,tab,leaseID))return false;
      const lease=this.leases[id];delete this.leases[id];
      if(!error){if(lease.todayOnly)this.lastAuto[id]=now;if(lease.day)this.daily[id]=lease.day;}
      if(lease.requestID&&this.job?.requestID===lease.requestID)this.job.results[id]={error,time:now};
      return true;
    }
    completion(){const job=this.job;if(!job||!job.ids.length||!job.ids.every(id=>job.results[id]))return null;return {requestID:job.requestID,error:job.ids.filter(id=>job.results[id].error).map(id=>`联盟 ${id}：${job.results[id].error}`).join('；')};}
    saved(){return {leases:this.leases,lastAuto:this.lastAuto,daily:this.daily,job:this.job,sequence:this.sequence};}
  }
  root.ThunderSyncCoordinator=SyncCoordinator;
  if(typeof module!=='undefined')module.exports=SyncCoordinator;
})(globalThis);
