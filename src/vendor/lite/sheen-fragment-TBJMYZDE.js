var c=2,g=8192,f=1<<29,R=`
fn normalDistributionFunction_CharlieSheen(NdotH_sh: f32, alphaG_sh: f32) -> f32 {
let invR = 1.0 / alphaG_sh;
let cos2h = NdotH_sh * NdotH_sh;
let sin2h = 1.0 - cos2h;
return (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * 3.141592653589793);
}
fn visibility_Ashikhmin(NdotL_sh: f32, NdotV_sh: f32) -> f32 {
return 1.0 / (4.0 * (NdotL_sh + NdotV_sh - NdotL_sh * NdotV_sh));
}
`,E=e=>`
{
let shIntensity = ${e};
let shColorScaled = sheenColorFinal * shIntensity;
let shRoughness_clamped = max(sheenRoughnessAdjusted, AA_factor_x);
let shAlphaG = shRoughness_clamped * shRoughness_clamped + 0.0005;
let shD = normalDistributionFunction_CharlieSheen(NdotH, shAlphaG);
let shV = visibility_Ashikhmin(NdotL, NdotV);
sheenDirectTerm = shColorScaled * shD * shV * NdotL * lightColor * lightAtten * material.directIntensity;
}
`,x=(e,n)=>`
{
let shIntensity_ibl = ${e};
let shColorScaled = sheenColorFinal * shIntensity_ibl;
let shRoughness_ibl = sheenRoughnessAdjusted;
let shAlphaG_ibl = shRoughness_ibl * shRoughness_ibl + 0.0005 + AA_factor_y;
var shSpecLod = log2(cubemapDim * shAlphaG_ibl) * scene.vImageInfos.z;
let shEnvRadiance = textureSampleLevel(iblTexture, iblSampler, R, clamp(shSpecLod, 0.0, maxLod)).rgb * material.environmentIntensity;
let shBrdf = textureSampleLevel(brdfLUT, brdfSampler_, vec2<f32>(NdotV, shRoughness_ibl), 0.0);
let shEnvReflectance = shColorScaled * shBrdf.b${n?" * seo * eho":""};
sheenIblTerm = shEnvRadiance * shEnvReflectance;
${n?`let shMax = max(shColorScaled.r, max(shColorScaled.g, shColorScaled.b));
sheenAlbedoScaling = 1.0 - shMax * shBrdf.b;`:""}
}
`,y=e=>e?`
{
color = (finalIrradiance
      + finalRadianceScaled
      + finalSpecularScaled
      + directDiffuse) * sheenAlbedoScaling
      + sheenDirectTerm
      + sheenIblTerm
      + emissive;
}
`:`
{
color = finalIrradiance
      + finalRadianceScaled
      + finalSpecularScaled
      + directDiffuse
      + sheenDirectTerm
      + sheenIblTerm
      + emissive;
}
`,T=`
{
color = color + sheenDirectTerm;
}
`;function N(e,n=!1,s=!1,t=!1,r=!1){let h=`var sheenDirectTerm = vec3<f32>(0.0);
var sheenIblTerm = vec3<f32>(0.0);
var sheenAlbedoScaling = 1.0;
var sheenColorFinal = material.sheenParams.rgb;
var sheenRoughnessAdjusted = material.sheenParams2.x;`;e&&(h+=`
{
${t?"let sheenUV = vec2<f32>(dot(material.sheenUVm.xy, input.uv), dot(material.sheenUVm.zw, input.uv)) + material.sheenUVt.xy;":"let sheenUV = input.uv;"}
let sheenMapData = textureSample(sheenTexture_, sheenSampler_, sheenUV);
sheenColorFinal *= ${s?"sheenMapData.rgb":"pow(sheenMapData.rgb, vec3<f32>(2.2))"};${r?"":`
sheenRoughnessAdjusted *= sheenMapData.a;`}
}`),r&&(h+=`
{
let sheenRoughUV = vec2<f32>(dot(material.sheenRoughUVm.xy, input.uv), dot(material.sheenRoughUVm.zw, input.uv)) + material.sheenRoughUVt.xy;
sheenRoughnessAdjusted *= textureSample(sheenRoughTexture_, sheenRoughSampler_, sheenRoughUV).a;
}`);let u=s?"material.sheenParams.a":"material.sheenParams.a * (1.0 - dielectricF0)",o={SV:h,AD:E(u)};n?o.AI=x(u,s)+y(s):o.NI=T;let l=[];e&&l.push({_name:"sheenTexture_",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:c},{_name:"sheenSampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:c}),r&&l.push({_name:"sheenRoughTexture_",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:c},{_name:"sheenRoughSampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:c});let a=[{_name:"sheenParams",_type:"vec4<f32>"},{_name:"sheenParams2",_type:"vec4<f32>"}];return t&&a.push({_name:"sheenUVm",_type:"vec4<f32>"},{_name:"sheenUVt",_type:"vec4<f32>"}),r&&a.push({_name:"sheenRoughUVm",_type:"vec4<f32>"},{_name:"sheenRoughUVt",_type:"vec4<f32>"}),{_id:"sheen",_dependencies:n?["ibl"]:void 0,_uboFields:a,_bindings:l,_helperFunctions:R,_fragmentSlots:o}}function V(e,n,s){let t=n.sheen;if(!t?.isEnabled||!s.has("sheenParams"))return;let r=s.get("sheenParams")/4,h=t.color??[1,1,1];e[r]=h[0],e[r+1]=h[1],e[r+2]=h[2],e[r+3]=t.intensity??1,e[r+4]=t.roughness??0,e[r+5]=t.texture?1:0,v(e,s,"sheenUVm","sheenUVt",t.texture),v(e,s,"sheenRoughUVm","sheenRoughUVt",t.roughnessTexture)}function v(e,n,s,t,r){let h=n.get(s),u=n.get(t);if(h===void 0||u===void 0)return;let o=r?.uScale??1,l=r?.vScale??1,a=r?.uAng??0,i=h/4,_=u/4;if(a===0)e[i]=o,e[i+1]=0,e[i+2]=0,e[i+3]=l;else{let m=Math.cos(a),p=Math.sin(a);e[i]=m*o,e[i+1]=p*l,e[i+2]=-p*o,e[i+3]=m*l}e[_]=r?.uOffset??0,e[_+1]=r?.vOffset??0,e[_+2]=0,e[_+3]=0}var A={id:"sheen",phase:"base-tex",detect(e){let n=e.sheen;if(!n?.isEnabled)return{f:0,f2:0};let s=4194304,t=0;return n.texture&&(s|=8388608,n.texture._hasTx&&(t|=g)),n.roughnessTexture&&(t|=f),n.albedoScaling&&(s|=1073741824),{f:s,f2:t}},frag(e){return e._features&4194304?N((e._features&8388608)!==0,e._hasIbl,(e._features&1073741824)!==0,(e._features2&g)!==0,(e._features2&f)!==0):null},writeUbo:V,bind(e,n,s){let t=e._material.sheen;return(e._features&8388608)!==0&&t?.texture&&(n.push({binding:s++,resource:t.texture.view}),n.push({binding:s++,resource:t.texture.sampler})),(e._features2&f)!==0&&t?.roughnessTexture&&(n.push({binding:s++,resource:t.roughnessTexture.view}),n.push({binding:s++,resource:t.roughnessTexture.sampler})),s},textures(e,n){let s=e.sheen;s?.texture&&n.push(s.texture),s?.roughnessTexture&&n.push(s.roughnessTexture)}};export{N as createSheenFragment,A as pbrExt,V as writeSheenUBO};
