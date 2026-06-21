import{me as l}from"./chunk-2GVZXICG.js";var i=2,n=`
fn computeSphericalCoords(worldPos: vec3<f32>, worldNormal: vec3<f32>) -> vec2<f32> {
let viewDir = normalize((scene.view * vec4<f32>(worldPos, 1.0)).xyz);
let viewNormal = normalize((scene.view * vec4<f32>(worldNormal, 0.0)).xyz);
var r = reflect(viewDir, viewNormal);
r.z = r.z - 1.0;
let m = 2.0 * length(r);
return vec2<f32>(r.x / m + 0.5, r.y / m + 0.5);
}
fn computePlanarCoords(worldPos: vec3<f32>, worldNormal: vec3<f32>) -> vec2<f32> {
let viewDir = worldPos - scene.vEyePosition.xyz;
let coords = normalize(reflect(viewDir, worldNormal));
return vec2<f32>(coords.x, 1.0 - coords.y);
}
`;function s(){return{_id:"std-reflection",_bindings:[{_name:"rT",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:i},{_name:"rS",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:i}],_helperFunctions:n,_fragmentSlots:{AD:`{
var reflCoords: vec2<f32>;
if (mat.rCm < 1.5) { reflCoords = computeSphericalCoords(input.vp, normalW); }
else { reflCoords = computePlanarCoords(input.vp, normalW); }
reflectionColor = textureSample(rT, rS, reflCoords).rgb * mat.rLvl;
}`}}}var a={_id:"std-reflection",_phase:"mesh",_feature:l,_frag:s,_bind(e,r,o){let t=e.reflectionTexture;return r.push({binding:o++,resource:t.texture.createView()}),r.push({binding:o++,resource:t.sampler}),o},_textures(e,r){e.reflectionTexture&&r.push(e.reflectionTexture)}};export{s as createStdReflectionFragment,a as stdReflectionExt};
