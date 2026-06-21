function i(c,m,o,e,n){let t=c.inputs.get(m);return t?.source?n.resolve(c,m,o,e):null}function u(c,m,o,e,n){let t=i(c,m,o,e,n);return t?n.cast(t,"f32").expr:null}var _={className:"CloudBlock",emit(c,m,o,e,n){let t=n.resolve(c,"seed",o,e);if(t.type!=="vec2f"&&t.type!=="vec3f")throw new Error(`NodeMaterial: CloudBlock requires vec2 or vec3 seed; got ${t.type}`);e[o].helpers.set("nme_cloudNoise",`fn nme_cloudRandom(p: f32) -> f32 {
var temp = fract(p * 0.011);
temp *= temp + 7.5;
temp *= temp + temp;
return fract(temp);
}
fn nme_cloudNoise2(x: vec2<f32>, chaos: vec2<f32>) -> f32 {
let stepv = chaos * vec2<f32>(75.0, 120.0) + vec2<f32>(75.0, 120.0);
let i = floor(x);
let f = fract(x);
let n = dot(i, stepv);
let u = f * f * (vec2<f32>(3.0) - 2.0 * f);
return mix(mix(nme_cloudRandom(n + dot(stepv, vec2<f32>(0.0, 0.0))), nme_cloudRandom(n + dot(stepv, vec2<f32>(1.0, 0.0))), u.x), mix(nme_cloudRandom(n + dot(stepv, vec2<f32>(0.0, 1.0))), nme_cloudRandom(n + dot(stepv, vec2<f32>(1.0, 1.0))), u.x), u.y);
}
fn nme_cloudNoise3(x: vec3<f32>, chaos: vec3<f32>) -> f32 {
let stepv = chaos * vec3<f32>(60.0, 120.0, 75.0) + vec3<f32>(60.0, 120.0, 75.0);
let i = floor(x);
let f = fract(x);
let n = dot(i, stepv);
let u = f * f * (vec3<f32>(3.0) - 2.0 * f);
return mix(mix(mix(nme_cloudRandom(n + dot(stepv, vec3<f32>(0.0, 0.0, 0.0))), nme_cloudRandom(n + dot(stepv, vec3<f32>(1.0, 0.0, 0.0))), u.x), mix(nme_cloudRandom(n + dot(stepv, vec3<f32>(0.0, 1.0, 0.0))), nme_cloudRandom(n + dot(stepv, vec3<f32>(1.0, 1.0, 0.0))), u.x), u.y), mix(mix(nme_cloudRandom(n + dot(stepv, vec3<f32>(0.0, 0.0, 1.0))), nme_cloudRandom(n + dot(stepv, vec3<f32>(1.0, 0.0, 1.0))), u.x), mix(nme_cloudRandom(n + dot(stepv, vec3<f32>(0.0, 1.0, 1.0))), nme_cloudRandom(n + dot(stepv, vec3<f32>(1.0, 1.0, 1.0))), u.x), u.y), u.z);
}`);let f=Math.max(0,Math.trunc(typeof c.serialized.octaves=="number"?c.serialized.octaves:6)),a=`nme_cloudFbm_${f}`;e[o].helpers.set(a,`fn nme_cloudFbm2_${f}(st: vec2<f32>, chaos: vec2<f32>) -> f32 {
var value = 0.0;
var amplitude = 0.5;
var tempST = st;
for (var i = 0; i < ${f}; i = i + 1) {
value += amplitude * nme_cloudNoise2(tempST, chaos);
tempST *= 2.0;
amplitude *= 0.5;
}
return value;
}
fn nme_cloudFbm3_${f}(x: vec3<f32>, chaos: vec3<f32>) -> f32 {
var value = 0.0;
var amplitude = 0.5;
var tempX = x;
for (var i = 0; i < ${f}; i = i + 1) {
value += amplitude * nme_cloudNoise3(tempX, chaos);
tempX *= 2.0;
amplitude *= 0.5;
}
return value;
}`);let v=n.temp(e,"cloudSeed");e[o].body.push(`var ${v}: ${t.type==="vec2f"?"vec2<f32>":"vec3<f32>"} = ${t.expr};`);let d=u(c,"offsetX",o,e,n),p=u(c,"offsetY",o,e,n),l=u(c,"offsetZ",o,e,n);d&&e[o].body.push(`${v}.x += 0.1 * ${d};`),p&&e[o].body.push(`${v}.y += 0.1 * ${p};`),l&&t.type==="vec3f"&&e[o].body.push(`${v}.z += 0.1 * ${l};`);let r=i(c,"chaos",o,e,n),s=r?n.cast(r,t.type).expr:t.type==="vec2f"?"vec2<f32>(0.0, 0.0)":"vec3<f32>(0.0, 0.0, 0.0)";return{expr:t.type==="vec2f"?`nme_cloudFbm2_${f}(${v}, ${s})`:`nme_cloudFbm3_${f}(${v}, ${s})`,type:"f32"}}};export{_ as emitter};
