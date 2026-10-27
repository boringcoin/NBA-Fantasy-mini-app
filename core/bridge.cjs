'use strict';
const http=require('node:http');
function createBridge(state,onChange=()=>{}){
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin||'',ext=req.headers['x-extension-id']||'',validExt=/^[a-p]{32}$/.test(ext);
    function reply(status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':origin||'null','Vary':'Origin'});res.end(JSON.stringify(data));}
    if(!['127.0.0.1:18747','127.0.0.1:0'].includes(req.headers.host)&&req.headers.host!==`127.0.0.1:${server.address()?.port}`)return reply(403,{error:'Host 不允许'});
    if(origin&&!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return reply(403,{error:'仅接受浏览器扩展连接'});
    if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':origin||'null','Access-Control-Allow-Headers':'content-type,authorization,x-client-id,x-extension-id','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Max-Age':'600'});return res.end();}
    if(req.method==='GET'&&req.url==='/health')return reply(200,{name:'Thunder Fantasy',version:require('../package.json').version});
    if(!validExt||(origin&&origin!==`chrome-extension://${ext}`))return reply(403,{error:'扩展身份无效'});
    async function body(){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Error('需要 JSON 格式');let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw Error('数据包过大');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    try{
      if(req.method==='POST'&&req.url==='/pair'){const b=await body();const result=state.pair(String(b.code||''),ext);onChange();return reply(200,{ok:true,...result});}
      if(!state.authorize(req.headers['x-client-id'],String(req.headers.authorization||'').replace(/^Bearer /,''),ext))return reply(401,{error:'配对已失效，请重新配对'});
      if(req.method==='GET'&&req.url==='/config')return reply(200,{leagues:state.data.leagues});
      if(req.method==='POST'&&req.url==='/import-league'){const league=state.importLeague(await body());onChange();return reply(200,{ok:true,league});}
      if(req.method==='POST'&&req.url==='/refresh-request'){await body();state.refresh('full');onChange();return reply(200,{ok:true});}
      if(req.method==='GET'&&req.url==='/refresh-request')return reply(200,state.command&&Date.now()-state.command.createdAt<600000?state.command:{});
      if(req.method==='POST'&&req.url==='/snapshot'){state.snapshot(await body());onChange();return reply(200,{ok:true});}
      if(req.method==='POST'&&req.url==='/refresh-status'){const b=await body();if(state.command?.requestID!==b.requestID)return reply(409,{error:'刷新请求已过期'});state.syncStatus={state:['started','completed'].includes(b.state)?b.state:'waiting',error:String(b.error||'').slice(0,1200),time:Date.now()};if(b.state==='completed')state.command=null;onChange();return reply(200,{ok:true});}
      reply(404,{error:'接口不存在'});
    }catch(error){reply(400,{error:error.message});}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;server.maxConnections=12;return server;
}
module.exports={createBridge};
