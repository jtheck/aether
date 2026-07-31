import"./chunk-Z5HOKALY.js";var l=2,i=`
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
`;function n(){return{_id:"std-reflection",_bindings:[{_name:"rT",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:l},{_name:"rS",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:l}],_helperFunctions:i,_fragmentSlots:{AD:`{
var reflCoords: vec2<f32>;
if (mat.rCm < 1.5) { reflCoords = computeSphericalCoords(input.vp, normalW); }
else { reflCoords = computePlanarCoords(input.vp, normalW); }
reflectionColor = textureSample(rT, rS, reflCoords).rgb * mat.rLvl;
}`}}}var s={_id:"std-reflection",_phase:"mesh",_feature:8192,_frag:n,_bind(e,r,o){let t=e.reflectionTexture;return r.push({binding:o++,resource:t.texture.createView()}),r.push({binding:o++,resource:t.sampler}),o},_textures(e,r){e.reflectionTexture&&r.push(e.reflectionTexture)}};export{n as createStdReflectionFragment,s as stdReflectionExt};
