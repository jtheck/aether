var C=1,N=2,T=4,F=8,S=1<<25,m=2,E=`
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
`,R=c=>`(vec2<f32>(dot(material.${c}m.xy, input.uv), dot(material.${c}m.zw, input.uv)) + material.${c}t.xy)`,V=c=>`material.ccParams.x * textureSample(ccIntensityTexture, ccIntensitySampler_, ${c}).r`,U="material.ccParams.x",$=c=>`clamp(material.ccParams.y * textureSample(ccRoughnessTexture, ccRoughnessSampler_, ${c}).g, 0.0, 1.0)`,L="material.ccParams.y",D=c=>`
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
let ccNormSampleRaw = textureSample(ccNormalTexture, ccNormalSampler_, ${c}).rgb * 2.0 - 1.0;
let ccNormScale = material.ccParams.z;
var ccN = normalize(cc_frame * normalize(ccNormSampleRaw * vec3<f32>(ccNormScale, ccNormScale, 1.0)));
`;function k(c){return`
{
let ccInt_r = ${c};
let remappedF0 = getR0RemappedForClearCoat(colorF0, material.ccRefractionParams.z, material.ccRefractionParams.w);
colorF0 = mix(colorF0, remappedF0, ccInt_r);
}
`}function H(c,l,t){let e=t?"ccN":"N_geom";return`
var ccDirectAttenuation = 1.0;
var ccDirectSpecularTerm = vec3<f32>(0.0);
{
let ccInt_dl = ${c};
let ccRough_dl = ${l};
let ccF0_dl = material.ccRefractionParams.x;
let ccAlphaG_dl = ccRough_dl * ccRough_dl + 0.0005;
let ccNdotL_dl = saturate(dot(${e}, L));
let ccH_dl = normalize(V + L);
let ccNdotH_dl = clamp(dot(${e}, ccH_dl), 0.0000001, 1.0);
let ccVdotH_dl = saturate(dot(V, ccH_dl));
let ccD_dl = distributionGGX(ccNdotH_dl, ccAlphaG_dl);
let ccVis_dl = visibility_Kelemen(ccVdotH_dl);
let ccFresnel_dl = ccSchlick(ccF0_dl, ccVdotH_dl);
let ccTerm = ccFresnel_dl * ccD_dl * ccVis_dl * ccNdotL_dl;
ccDirectSpecularTerm = vec3<f32>(ccTerm) * lightColor * lightAtten * material.directIntensity * ccInt_dl;
ccDirectAttenuation = 1.0 - ccFresnel_dl * ccInt_dl;
}
`}function M(c,l,t,e,r){let n=t?"ccN":"N_geom",i=e?`let ccAlphaG_ibl_base = ccRough_ibl * ccRough_ibl + 0.0005;
let cc_nDfdx_AA = dpdx(${n});
let cc_nDfdy_AA = dpdy(${n});
let cc_slopeSquare_AA = max(dot(cc_nDfdx_AA, cc_nDfdx_AA), dot(cc_nDfdy_AA, cc_nDfdy_AA));
let ccAlphaG_ibl = ccAlphaG_ibl_base + sqrt(cc_slopeSquare_AA) * 0.75;`:"let ccAlphaG_ibl = ccRough_ibl * ccRough_ibl + 0.0005;",_=r?`let ccEho_ibl = environmentHorizonOcclusion(-V, ${n}, N_geom);`:"let ccEho_ibl = 1.0;";return`
{
let ccInt_ibl = ${c};
let ccRough_ibl = ${l};
let ccF0_ibl = material.ccRefractionParams.x;
let ccR_raw = reflect(-V, ${n});
let ccR_ibl = rotateY(ccR_raw, scene.envRotationY);
let ccNdotV_ibl = abs(dot(${n}, V)) + 0.0000001;
${i}
var ccSpecLod_ibl = log2(cubemapDim * ccAlphaG_ibl) * scene.vImageInfos.z;
let ccEnvRadiance_ibl = textureSampleLevel(iblTexture, iblSampler, ccR_ibl, clamp(ccSpecLod_ibl, 0.0, maxLod)).rgb * material.environmentIntensity;
let ccBrdf_ibl = textureSample(brdfLUT, brdfSampler_, vec2<f32>(ccNdotV_ibl, ccRough_ibl)).rgb;
${_}
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
`}function B(c){return`
{
let ccF0_noIbl = material.ccRefractionParams.x;
let ccInt_noIbl = ${c};
let ccFresnelNoIbl = ccSchlick(ccF0_noIbl, NdotV);
let ccCons_noIbl = 1.0 - ccFresnelNoIbl * ccInt_noIbl;
color = (color - emissive) * ccCons_noIbl + emissive + ccDirectSpecularTerm;
}
`}function G(c,l,t,e,r){if((c&1048576)===0)return null;let n=(c&3072)!==0,i=(l&C)!==0,_=(l&N)!==0,a=(l&T)!==0,o=(l&F)!==0,s=(l&S)!==0,u=s?R("ccIntUV"):"input.uv",p=s?R("ccRoughUV"):"input.uv",I=s?R("ccNormUV"):"input.uv",d=i?V(u):U,g=_?$(p):L,f={MF:o?"":k(d),AD:H(d,g,a),BL:`var ccDirectAttenuation = 1.0;
var ccDirectSpecularTerm = vec3<f32>(0.0);`};a&&(f.AC=D(I)),t?f.AI=M(d,g,a,r,e):f.NI=B(d);let b=[];t&&b.push("ibl"),n&&b.push("reflectance");let y=(i?"I":"")+(_?"R":"")+(a?"N":"")+(o?"X":"")+(r?"A":"")+(e?"B":"")+(s?"U":""),v=[];i&&v.push({_name:"ccIntensityTexture",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:m},{_name:"ccIntensitySampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:m}),_&&v.push({_name:"ccRoughnessTexture",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:m},{_name:"ccRoughnessSampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:m}),a&&v.push({_name:"ccNormalTexture",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:m},{_name:"ccNormalSampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:m});let h=[{_name:"ccParams",_type:"vec4<f32>"},{_name:"ccRefractionParams",_type:"vec4<f32>"}];return s&&(i&&h.push({_name:"ccIntUVm",_type:"vec4<f32>"},{_name:"ccIntUVt",_type:"vec4<f32>"}),_&&h.push({_name:"ccRoughUVm",_type:"vec4<f32>"},{_name:"ccRoughUVt",_type:"vec4<f32>"}),a&&h.push({_name:"ccNormUVm",_type:"vec4<f32>"},{_name:"ccNormUVt",_type:"vec4<f32>"})),{_id:y?`clearcoat-${y}`:"clearcoat",_dependencies:b.length>0?b:void 0,_uboFields:h,_bindings:v,_helperFunctions:E,_fragmentSlots:f}}function O(c,l,t){let e=l.clearCoat;if(!e?.isEnabled||!t.has("ccParams"))return;let r=t.get("ccParams")/4,n=e.indexOfRefraction??1.5,i=1-n,_=1+n;c[r]=e.intensity??1,c[r+1]=e.roughness??0,c[r+2]=e.bumpTextureScale??1,c[r+4]=Math.pow(-i/_,2),c[r+5]=1/n,c[r+6]=i,c[r+7]=_,x(c,t,"ccIntUV",e.texture),x(c,t,"ccRoughUV",e.roughnessTexture),x(c,t,"ccNormUV",e.bumpTexture)}function x(c,l,t,e){let r=l.get(`${t}m`),n=l.get(`${t}t`);if(r===void 0||n===void 0)return;let i=e?.uScale??1,_=e?.vScale??1,a=e?.uAng??0,o=r/4;if(a===0)c[o]=i,c[o+1]=0,c[o+2]=0,c[o+3]=_;else{let u=Math.cos(a),p=Math.sin(a);c[o]=u*i,c[o+1]=p*_,c[o+2]=-p*i,c[o+3]=u*_}let s=n/4;c[s]=e?.uOffset??0,c[s+1]=e?.vOffset??0}var A=[[C,"texture"],[N,"roughnessTexture"],[T,"bumpTexture"]],X={id:"clearcoat",phase:"base-tex",detect(c){let l=c.clearCoat;if(!l?.isEnabled)return{f:0,f2:0};let t=0;for(let[r,n]of A)l[n]&&(t|=r);let e=r=>!!r?._hasTx;return(e(l.texture)||e(l.roughnessTexture)||e(l.bumpTexture))&&(t|=S),l.useF0Remap===!1&&(t|=F),{f:1048576,f2:t}},frag:c=>G(c._features,c._features2,c._hasIbl,c._hasAnyNormal,c._hasSpecularAA),writeUbo:O,bind(c,l,t){let e=c._material.clearCoat;if(!e)return t;for(let[r,n]of A){let i=e[n];(c._features2&r)!==0&&i&&(l.push({binding:t++,resource:i.view}),l.push({binding:t++,resource:i.sampler}))}return t},textures(c,l){let t=c.clearCoat;if(t)for(let[,e]of A){let r=t[e];r&&l.push(r)}}};export{G as createClearcoatFragment,X as pbrExt,O as writeClearcoatUBO};
