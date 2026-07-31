var y=134217728,f=`
const RECIPROCAL_PI: f32 = 0.3183098861837907;
fn getAnisotropicRoughness(alphaG: f32, anisotropy: f32) -> vec2<f32> {
let aT = max(mix(alphaG, 1.0, anisotropy * anisotropy), 0.0005);
let aB = max(alphaG, 0.0005);
return vec2<f32>(aT, aB);
}
fn D_GGX_Anisotropic(NdotH: f32, TdotH: f32, BdotH: f32, alphaTB: vec2<f32>) -> f32 {
let a2 = alphaTB.x * alphaTB.y;
let v = vec3<f32>(alphaTB.y * TdotH, alphaTB.x * BdotH, a2 * NdotH);
let v2 = dot(v, v);
let w2 = a2 / v2;
return a2 * w2 * w2 * RECIPROCAL_PI;
}
fn V_GGXCorrelated_Anisotropic(NdotL: f32, NdotV: f32, TdotV: f32, BdotV: f32, TdotL: f32, BdotL: f32, alphaTB: vec2<f32>) -> f32 {
let lambdaV = NdotL * length(vec3<f32>(alphaTB.x * TdotV, alphaTB.y * BdotV, NdotV));
let lambdaL = NdotV * length(vec3<f32>(alphaTB.x * TdotL, alphaTB.y * BdotL, NdotL));
return 0.5 / (lambdaV + lambdaL);
}
`;function B(o,n=!1){let i=`var anisoIntensityF = material.anisotropyParams.x;
var anisoDir2 = vec2<f32>(material.anisotropyParams.y, material.anisotropyParams.z);
${n?`let anisoUV = vec2<f32>(dot(material.anisotropyUVm.xy, input.uv), dot(material.anisotropyUVm.zw, input.uv)) + material.anisotropyUVt.xy;
let anisoTexData = textureSample(anisotropyTexture_, anisotropySampler_, anisoUV).rgb;
anisoIntensityF = anisoIntensityF * anisoTexData.b;
let anisoNdir = normalize(anisoTexData.rg * 2.0 - vec2<f32>(1.0));
anisoDir2 = vec2<f32>(anisoDir2.x * anisoNdir.x - anisoDir2.y * anisoNdir.y, anisoDir2.y * anisoNdir.x + anisoDir2.x * anisoNdir.y);
`:""}`;return o?`${i}var anisoT = normalize(input.worldTangent);
var anisoB = normalize(input.worldBitangent);
{
let anisoDir = normalize(anisoDir2);
anisoT = normalize(anisoT * anisoDir.x + anisoB * anisoDir.y);
anisoB = normalize(cross(N, anisoT));
}`:`${i}var anisoT: vec3<f32>;
var anisoB: vec3<f32>;
{
let aniso_Ngeom = normalize(input.worldNormal);
let aniso_dp1 = dpdx(input.worldPos);
let aniso_dp2 = dpdy(input.worldPos);
let aniso_duv1 = dpdx(input.uv);
let aniso_duv2 = dpdy(input.uv);
let aniso_dp2perp = cross(aniso_dp2, aniso_Ngeom);
let aniso_dp1perp = cross(aniso_Ngeom, aniso_dp1);
let aniso_tct = aniso_dp2perp * aniso_duv1.x + aniso_dp1perp * aniso_duv2.x;
let aniso_bct = -(aniso_dp2perp * aniso_duv1.y + aniso_dp1perp * aniso_duv2.y);
let aniso_det = max(dot(aniso_tct, aniso_tct), dot(aniso_bct, aniso_bct));
let aniso_inv = select(inverseSqrt(aniso_det), 0.0, aniso_det == 0.0);
let anisoTBN = mat3x3<f32>(normalize(aniso_tct * aniso_inv), normalize(aniso_bct * aniso_inv), N);
let anisoDir = vec3<f32>(anisoDir2.x, anisoDir2.y, 0.0);
anisoT = normalize(anisoTBN * anisoDir);
anisoB = normalize(cross(anisoTBN[2], anisoT));
}`}var v=`let aniso_alphaTB = getAnisotropicRoughness(directAlphaG, anisoIntensityF);
let dl_TdotH = dot(anisoT, H); let dl_BdotH = dot(anisoB, H);
let dl_TdotV = dot(anisoT, V); let dl_BdotV = dot(anisoB, V);
let dl_TdotL = dot(anisoT, L); let dl_BdotL = dot(anisoB, L);
let D = D_GGX_Anisotropic(NdotH, dl_TdotH, dl_BdotH, aniso_alphaTB);
let G = V_GGXCorrelated_Anisotropic(NdotL, NdotV, dl_TdotV, dl_BdotV, dl_TdotL, dl_BdotL, aniso_alphaTB);`,x=`var anisoBentNormal = cross(anisoB, V);
anisoBentNormal = normalize(cross(anisoBentNormal, anisoB));
let anisoSq = 1.0 - anisoIntensityF * (1.0 - roughness);
let anisoA = anisoSq * anisoSq * anisoSq * anisoSq;
anisoBentNormal = normalize(mix(anisoBentNormal, N, anisoA));
let R_raw = reflect(-V, anisoBentNormal);`,N={id:"anisotropy",phase:"fragment",detect(o){let n=o.anisotropy;return{f:0,f2:n?.isEnabled&&n.texture?134217728:0}},frag(o){return(o._features2&134217728)===0?null:{_id:"anisotropy-tex",_bindings:[{_name:"anisotropyTexture_",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:2},{_name:"anisotropySampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:2}],_uboFields:[{_name:"anisotropyUVm",_type:"vec4<f32>"},{_name:"anisotropyUVt",_type:"vec4<f32>"}]}},writeUbo(o,n,t){let i=n.anisotropy;if(!i?.isEnabled||!t.has("anisotropyParams"))return;let r=t.get("anisotropyParams")/4,_=i.direction??[1,0];o[r]=i.intensity??1,o[r+1]=_[0],o[r+2]=_[1];let c=t.get("anisotropyUVm"),m=t.get("anisotropyUVt");if(c===void 0||m===void 0)return;let s=i.texture,l=s?.uScale??1,d=s?.vScale??1,p=s?.uAng??0,a=c/4,e=m/4;if(p===0)o[a]=l,o[a+1]=0,o[a+2]=0,o[a+3]=d;else{let u=Math.cos(p),T=Math.sin(p);o[a]=u*l,o[a+1]=T*d,o[a+2]=-T*l,o[a+3]=u*d}o[e]=s?.uOffset??0,o[e+1]=s?.vOffset??0,o[e+2]=0,o[e+3]=0},bind(o,n,t){let i=o._material.anisotropy;return(o._features2&134217728)===0||!i?.texture||(n.push({binding:t++,resource:i.texture.view}),n.push({binding:t++,resource:i.texture.sampler})),t},textures(o,n){let t=o.anisotropy;t?.texture&&n.push(t.texture)}};export{x as ANISO_BENT_NORMAL,f as ANISO_BRDF_FUNCTIONS,v as ANISO_DIRECT_DG,y as PBR2_HAS_ANISO_TEX,B as makeAnisotropyTBBlock,N as pbrExt};
