import fs from 'fs';
const s = fs.readFileSync('./vendor/lite/liteVendor.js', 'utf8');
const start = s.indexOf('function _0(e,t,r={})');
console.log(s.slice(start, start + 2200));
