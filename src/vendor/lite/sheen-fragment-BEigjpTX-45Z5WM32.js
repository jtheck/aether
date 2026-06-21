import{bc as d,cc as m,ic as p,wc as v}from"./chunk-ZBW7LZ4P.js";var g=2,R=`
fn normalDistributionFunction_CharlieSheen(NdotH_sh: f32, alphaG_sh: f32) -> f32 {
let invR = 1.0 / alphaG_sh;
let cos2h = NdotH_sh * NdotH_sh;
let sin2h = 1.0 - cos2h;
return (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * 3.141592653589793);
}
fn visibility_Ashikhmin(NdotL_sh: f32, NdotV_sh: f32) -> f32 {
return 1.0 / (4.0 * (NdotL_sh + NdotV_sh - NdotL_sh * NdotV_sh));
}
`,N=e=>`
{
let shIntensity = ${e};
let shColorScaled = sheenColorFinal * shIntensity;
let shRoughness_clamped = max(sheenRoughnessAdjusted, AA_factor_x);
let shAlphaG = shRoughness_clamped * shRoughness_clamped + 0.0005;
let shD = normalDistributionFunction_CharlieSheen(NdotH, shAlphaG);
let shV = visibility_Ashikhmin(NdotL, NdotV);
sheenDirectTerm = shColorScaled * shD * shV * NdotL * lightColor * lightAtten * material.directIntensity;
}
`,A=(e,n)=>`
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
`,D=`
{
color = color + sheenDirectTerm;
}
`;function I(e,n=!1,s=!1,t=!1){let i=`var sheenDirectTerm = vec3<f32>(0.0);
var sheenIblTerm = vec3<f32>(0.0);
var sheenAlbedoScaling = 1.0;
var sheenColorFinal = material.sheenParams.rgb;
var sheenRoughnessAdjusted = material.sheenParams2.x;`;e&&(i+=`
{
${t?"let sheenUV = vec2<f32>(dot(material.sheenUVm.xy, input.uv), dot(material.sheenUVm.zw, input.uv)) + material.sheenUVt.xy;":"let sheenUV = input.uv;"}
let sheenMapData = textureSample(sheenTexture_, sheenSampler_, sheenUV);
sheenColorFinal *= ${s?"sheenMapData.rgb":"pow(sheenMapData.rgb, vec3<f32>(2.2))"};
sheenRoughnessAdjusted *= sheenMapData.a;
}`);let h=s?"material.sheenParams.a":"material.sheenParams.a * (1.0 - dielectricF0)",o={SV:i,AD:N(h)};n?o.AI=A(h,s)+y(s):o.NI=D;let a=[];e&&a.push({_name:"sheenTexture_",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:g},{_name:"sheenSampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:g});let l=[{_name:"sheenParams",_type:"vec4<f32>"},{_name:"sheenParams2",_type:"vec4<f32>"}];return t&&l.push({_name:"sheenUVm",_type:"vec4<f32>"},{_name:"sheenUVt",_type:"vec4<f32>"}),{_id:"sheen",_dependencies:n?["ibl"]:void 0,_uboFields:l,_bindings:a,_helperFunctions:R,_fragmentSlots:o}}function V(e,n,s){let t=n.sheen;if(!t?.isEnabled||!s.has("sheenParams"))return;let i=s.get("sheenParams")/4,h=t.color??[1,1,1];e[i]=h[0],e[i+1]=h[1],e[i+2]=h[2],e[i+3]=t.intensity??1,e[i+4]=t.roughness??0,e[i+5]=t.texture?1:0;let o=s.get("sheenUVm"),a=s.get("sheenUVt");if(o===void 0||a===void 0)return;let l=t.texture,c=l?.uScale??1,_=l?.vScale??1,f=l?.uAng??0,E=l?.uOffset??0,x=l?.vOffset??0,r=o/4,u=a/4;if(f===0)e[r]=c,e[r+1]=0,e[r+2]=0,e[r+3]=_;else{let S=Math.cos(f),b=Math.sin(f);e[r]=S*c,e[r+1]=-b*_,e[r+2]=b*c,e[r+3]=S*_}e[u]=E,e[u+1]=x,e[u+2]=0,e[u+3]=0}var H={id:"sheen",phase:"base-tex",detect(e){let n=e.sheen;if(!n?.isEnabled)return{f:0,f2:0};let s=d,t=0;return n.texture&&(s|=m,n.texture._hasTx&&(t|=v)),n.albedoScaling&&(s|=p),{f:s,f2:t}},frag(e){return e._features&d?I((e._features&m)!==0,e._hasIbl,(e._features&p)!==0,(e._features2&v)!==0):null},writeUbo:V,bind(e,n,s){if((e._features&m)===0)return s;let t=e._material.sheen;return t?.texture&&(n.push({binding:s++,resource:t.texture.view}),n.push({binding:s++,resource:t.texture.sampler})),s},textures(e,n){let s=e.sheen;s?.texture&&n.push(s.texture)}};export{I as createSheenFragment,H as pbrExt,V as writeSheenUBO};
