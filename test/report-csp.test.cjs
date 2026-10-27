'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {withCSP}=require('../core/html.cjs');
test('offline report script hashes agree with HTML parsing for LF, Windows CRLF, and CR templates',()=>{
  const code='\nconst title="球队统计";\ndocument.title=title;\n',digest=crypto.createHash('sha256').update(code).digest('base64');
  const results=['\n','\r\n','\r'].map(eol=>withCSP('<html><head></head><body><script>'+code.replace(/\n/g,eol)+'</script></body></html>'));
  for(const html of results){assert.ok(html.includes("'sha256-"+digest+"'"));assert.equal(html.match(/<script>([\s\S]*?)<\/script>/)[1],code);assert.ok(html.includes("connect-src 'none'"));}
  assert.equal(results[0],results[1]);assert.equal(results[0],results[2]);
});
