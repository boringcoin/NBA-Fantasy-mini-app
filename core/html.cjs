'use strict';
const crypto=require('node:crypto');
function withCSP(html){
  // HTML parsing normalizes CRLF and CR before CSP checks inline script text.
  // Hash the same text on Windows, macOS, and when a template was edited in either OS.
  html=html.replace(/\r\n?/g,'\n');
  const hashes=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
  return html.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${hashes}; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">`);
}
module.exports={withCSP};
