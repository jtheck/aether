import{Zb as y,_b as F,cc as u,mc as f,nc as b,oc as R,pc as v}from"./chunk-2GVZXICG.js";var _=2,N=`
fn visibility_Kelemen(VdotH_kl: f32) -> f32 {
return 0.25 / (VdotH_kl * VdotH_kl + 0.0000001);
}
fn getR0RemappedForClearCoat(f0_rc: vec3<f32>, ccA: f32, ccB: f32) -> vec3<f32> {
let sf0 = sqrt(f0_rc);
let num = ccA + ccB * sf0;
let den = ccB + ccA * sf0;
return saturate((num / den) * (num / den));
}
fn ccSchlick(f0: f32, cosTheta: f32) -> f32 {
let t = 1.0 - cosTheta;
let t2 = t * t;
return f0 + (1.0 - f0) * (t2 * t2 * t);
}
`,S="material.ccParams.x * textureSample(ccIntensityTexture, ccIntensitySampler_, input.uv).r",g="material.ccParams.x",I="clamp(material.ccParams.y * textureSample(ccRoughnessTexture, ccRoughnessSampler_, input.uv).g, 0.0, 1.0)",T="material.ccParams.y",P=`
let cc_dp1 = dpdx(input.worldPos);
let cc_dp2 = dpdy(input.worldPos);
let cc_duv1 = dpdx(input.uv);
let cc_duv2 = dpdy(input.uv);
let cc_dp2perp = cross(cc_dp2, N_geom);
let cc_dp1perp = cross(N_geom, cc_dp1);
let cc_tFrame = cc_dp2perp * cc_duv1.x + cc_dp1perp * cc_duv2.x;
let cc_bFrame = -(cc_dp2perp * cc_duv1.y + cc_dp1perp * cc_duv2.y);
let cc_det = max(dot(cc_tFrame, cc_tFrame), dot(cc_bFrame, cc_bFrame));
let cc_invmax = select(inverseSqrt(cc_det), 0.0, cc_det == 0.0);
let cc_frame = mat3x3<f32>(cc_tFrame * cc_invmax, cc_bFrame * cc_invmax, N_geom);
let ccNormSampleRaw = textureSample(ccNormalTexture, ccNormalSampler_, input.uv).rgb * 2.0 - 1.0;
let ccNormScale = material.ccParams.z;
var ccN = normalize(cc_frame * normalize(ccNormSampleRaw * vec3<f32>(ccNormScale, ccNormScale, 1.0)));
`;function E(c){return`
{
let ccInt_r = ${c};
let remappedF0 = getR0RemappedForClearCoat(colorF0, material.ccRefractionParams.z, material.ccRefractionParams.w);
colorF0 = mix(colorF0, remappedF0, ccInt_r);
}
`}function L(c,l,e){let t=e?"ccN":"N_geom";return`
var ccDirectAttenuation = 1.0;
var ccDirectSpecularTerm = vec3<f32>(0.0);
{
let ccInt_dl = ${c};
let ccRough_dl = ${l};
let ccF0_dl = material.ccRefractionParams.x;
let ccAlphaG_dl = ccRough_dl * ccRough_dl + 0.0005;
let ccNdotL_dl = saturate(dot(${t}, L));
let ccH_dl = normalize(V + L);
let ccNdotH_dl = clamp(dot(${t}, ccH_dl), 0.0000001, 1.0);
let ccVdotH_dl = saturate(dot(V, ccH_dl));
let ccD_dl = distributionGGX(ccNdotH_dl, ccAlphaG_dl);
let ccVis_dl = visibility_Kelemen(ccVdotH_dl);
let ccFresnel_dl = ccSchlick(ccF0_dl, ccVdotH_dl);
let ccTerm = ccFresnel_dl * ccD_dl * ccVis_dl * ccNdotL_dl;
ccDirectSpecularTerm = vec3<f32>(ccTerm) * lightColor * lightAtten * material.directIntensity * ccInt_dl;
ccDirectAttenuation = 1.0 - ccFresnel_dl * ccInt_dl;
}
`}function D(c,l,e,t,r){let a=e?"ccN":"N_geom",n=t?`let ccAlphaG_ibl_base = ccRough_ibl * ccRough_ibl + 0.0005;
let cc_nDfdx_AA = dpdx(${a});
let cc_nDfdy_AA = dpdy(${a});
let cc_slopeSquare_AA = max(dot(cc_nDfdx_AA, cc_nDfdx_AA), dot(cc_nDfdy_AA, cc_nDfdy_AA));
let ccAlphaG_ibl = ccAlphaG_ibl_base + sqrt(cc_slopeSquare_AA) * 0.75;`:"let ccAlphaG_ibl = ccRough_ibl * ccRough_ibl + 0.0005;",i=r?`let ccEho_ibl = environmentHorizonOcclusion(-V, ${a}, N_geom);`:"let ccEho_ibl = 1.0;";return`
{
let ccInt_ibl = ${c};
let ccRough_ibl = ${l};
let ccF0_ibl = material.ccRefractionParams.x;
let ccR_raw = reflect(-V, ${a});
let ccR_ibl = rotateY(ccR_raw, scene.envRotationY);
let ccNdotV_ibl = abs(dot(${a}, V)) + 0.0000001;
${n}
var ccSpecLod_ibl = log2(cubemapDim * ccAlphaG_ibl) * scene.vImageInfos.z;
let ccEnvRadiance_ibl = textureSampleLevel(iblTexture, iblSampler, ccR_ibl, clamp(ccSpecLod_ibl, 0.0, maxLod)).rgb * material.environmentIntensity;
let ccBrdf_ibl = textureSample(brdfLUT, brdfSampler_, vec2<f32>(ccNdotV_ibl, ccRough_ibl)).rgb;
${i}
let ccSpecEnvRefl = (vec3<f32>(ccF0_ibl) * ccBrdf_ibl.y + (vec3<f32>(1.0) - vec3<f32>(ccF0_ibl)) * ccBrdf_ibl.x) * ccInt_ibl * ccEho_ibl;
let ccFresnelIBL = ccSchlick(ccF0_ibl, ccNdotV_ibl);
let ccConservation_ibl = 1.0 - ccFresnelIBL * ccInt_ibl;
let ccFinalRadiance_ibl = ccEnvRadiance_ibl * ccSpecEnvRefl;
color = finalIrradiance * ccConservation_ibl
      + finalRadianceScaled * ccConservation_ibl
      + finalSpecularScaled * ccDirectAttenuation
      + directDiffuse * ccDirectAttenuation
      + ccDirectSpecularTerm
      + ccFinalRadiance_ibl
      + emissive;
}
`}function k(c){return`
{
let ccF0_noIbl = material.ccRefractionParams.x;
let ccInt_noIbl = ${c};
let ccFresnelNoIbl = ccSchlick(ccF0_noIbl, NdotV);
let ccCons_noIbl = 1.0 - ccFresnelNoIbl * ccInt_noIbl;
color = (color - emissive) * ccCons_noIbl + emissive + ccDirectSpecularTerm;
}
`}function H(c,l,e,t,r){if((c&u)===0)return null;let a=(c&(y|F))!==0,n=(l&f)!==0,i=(l&b)!==0,o=(l&R)!==0,h=(l&v)!==0,s=n?S:g,x=i?I:T,d={MF:h?"":E(s),AD:L(s,x,o),BL:`var ccDirectAttenuation = 1.0;
var ccDirectSpecularTerm = vec3<f32>(0.0);`};o&&(d.AC=P),e?d.AI=D(s,x,o,r,t):d.NI=k(s);let m=[];e&&m.push("ibl"),a&&m.push("reflectance");let C=(n?"I":"")+(i?"R":"")+(o?"N":"")+(h?"X":"")+(r?"A":"")+(t?"B":""),p=[];return n&&p.push({_name:"ccIntensityTexture",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:_},{_name:"ccIntensitySampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:_}),i&&p.push({_name:"ccRoughnessTexture",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:_},{_name:"ccRoughnessSampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:_}),o&&p.push({_name:"ccNormalTexture",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:_},{_name:"ccNormalSampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:_}),{_id:C?`clearcoat-${C}`:"clearcoat",_dependencies:m.length>0?m:void 0,_uboFields:[{_name:"ccParams",_type:"vec4<f32>"},{_name:"ccRefractionParams",_type:"vec4<f32>"}],_bindings:p,_helperFunctions:N,_fragmentSlots:d}}function M(c,l,e){let t=l.clearCoat;if(!t?.isEnabled||!e.has("ccParams"))return;let r=e.get("ccParams")/4,a=t.indexOfRefraction??1.5,n=1-a,i=1+a;c[r]=t.intensity??1,c[r+1]=t.roughness??0,c[r+2]=t.bumpTextureScale??1,c[r+4]=Math.pow(-n/i,2),c[r+5]=1/a,c[r+6]=n,c[r+7]=i}var A=[[f,"texture"],[b,"roughnessTexture"],[R,"bumpTexture"]],B={id:"clearcoat",phase:"base-tex",detect(c){let l=c.clearCoat;if(!l?.isEnabled)return{f:0,f2:0};let e=0;for(let[t,r]of A)l[r]&&(e|=t);return l.useF0Remap===!1&&(e|=v),{f:u,f2:e}},frag:c=>H(c._features,c._features2,c._hasIbl,c._hasAnyNormal,c._hasSpecularAA),writeUbo:M,bind(c,l,e){let t=c._material.clearCoat;if(!t)return e;for(let[r,a]of A){let n=t[a];(c._features2&r)!==0&&n&&(l.push({binding:e++,resource:n.view}),l.push({binding:e++,resource:n.sampler}))}return e},textures(c,l){let e=c.clearCoat;if(e)for(let[,t]of A){let r=e[t];r&&l.push(r)}}};export{H as createClearcoatFragment,B as pbrExt,M as writeClearcoatUBO};
