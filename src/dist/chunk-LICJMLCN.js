import{a as Ht}from"./chunk-KMICQX26.js";import{$ as Kt,Fa as jt,Fc as Re,Ga as Xt,Gc as bt,Hc as co,Ia as Yt,Nb as we,Ob as ht,Pb as gt,Pg as $e,R as Wt,Rb as vt,Sb as ot,Sg as fo,Tb as at,Tg as xt,U as zt,Ub as rt,Ug as Bt,V as mt,Vb as St,Vg as At,Wb as Jt,Wg as nt,Xb as Qt,Xg as po,Yg as mo,Zb as Zt,_ as qt,_b as eo,a as tt,aa as Ie,ac as to,dc as oo,ec as ao,hc as ro,n as Ut,nc as so,o as kt,p as Dt,sc as no,tc as lo,uc as st,ue as uo,vc as io,we as _o,yc as Oe,zc as he}from"./chunk-LFLB3D3T.js";var lt=new Map,wt=null;function vo(t){wt!==t._device&&(lt.clear(),wt=t._device)}function Lo(){lt.clear(),wt=null}function Co(t,r,l,f,c,s,B=""){vo(t);let M=`${r}:${l}:${f}:${c}:${B}`,T=lt.get(M);if(T)return T;let P=t._device,h=P.createBindGroupLayout(s._meshBGLDescriptor),n=null;s._shadowBGLDescriptor&&(n=P.createBindGroupLayout(s._shadowBGLDescriptor));let m={_features:r,_features2:l,_meshFeatures:f,_meshBGL:h,_shadowBGL:n,_composed:s,_pipelines:new Map};return lt.set(M,m),m}function Fo(t,r,l){vo(t);let f=Dt(r),c=l._pipelines.get(f);if(c)return c;let s=t._device,{_features:B,_features2:M,_composed:T}=l,P=(M&he)!==0,h=!P&&(B&at)!==0,n=(B&St)!==0,m=Wt(t),E=l._shadowBGL?[m,l._meshBGL,l._shadowBGL]:[m,l._meshBGL],H=s.createShaderModule({code:T._vertexWGSL}),b=(M&Oe)!==0,U=!r._colorFormat&&!b?null:s.createShaderModule({code:T._fragmentWGSL}),A=b?null:{format:r._colorFormat,writeMask:Ut.ALL};h&&A&&(A.blend={color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}});let g=s.createRenderPipeline({layout:s.createPipelineLayout({bindGroupLayouts:E}),vertex:{module:H,entryPoint:"main",buffers:T._vertexBufferLayouts},...U?{fragment:{module:U,entryPoint:"main",targets:A?[A]:[]}}:{},...r._depthStencilFormat?{depthStencil:{format:r._depthStencilFormat,depthCompare:r._depthCompare??kt,depthWriteEnabled:b||P||!h}}:{},multisample:{count:r._sampleCount},primitive:{topology:"triangle-list",cullMode:n?"none":"back",frontFace:"ccw"}});return l._pipelines.set(f,g),g}function ho(t,r,l,f,c,s,B,M,T){let P=t._device,h=r._features,n=r._features2,m=r._meshFeatures,E=(h&we)!==0&&(m&$e)!==0,H=(h&we)!==0&&(m&$e)===0,b=E||H,U=(h&ht)!==0,A=(h&rt)!==0,g=(n&he)!==0,v=[],S=0,x=p=>{v.push({binding:S++,resource:p.view}),v.push({binding:S++,resource:p.sampler})},k={_engine:t,_features:h,_features2:n,_meshFeatures:m,_material:s,_mesh:M??void 0,_env:B,_refractionTexture:T},G=co(),q=l._fragmentKey?l._fragmentKey.split("|").filter(p=>p.length>0):[];v.push({binding:S++,resource:{buffer:f}}),v.push({binding:S++,resource:{buffer:c}});for(let p of G)p.phase==="vertex"&&p.bind&&(S=p.bind(k,v,S));x(s.baseColorTexture),b&&x(s.normalTexture),x(s.ormTexture),(n&st)!==0&&(m&nt)!==0&&s.occlusionTexture&&x(s.occlusionTexture),U&&x(s.emissiveTexture),A&&x(s.specGlossTexture),g&&v.push({binding:S++,resource:{buffer:s._esmShadowParamsUBO}});let K=[];for(let p of q){let y=G.find(_=>_.id===p||p.startsWith(_.id+"-"));!y||y.phase==="vertex"||!y.bind||K.includes(y)||(K.push(y),S=y.bind(k,v,S))}return P.createBindGroup({layout:r._meshBGL,entries:v})}var yt=2,Mo=`
const PI:f32=3.14159265358979323846;
fn distributionGGX(NdotH:f32,alphaG:f32)->f32{
let a2=alphaG*alphaG;
let d=NdotH*NdotH*(a2-1.0)+1.0;
return a2/(PI*d*d);
}
fn geometrySmithGGX(NdotL:f32,NdotV:f32,alphaG:f32)->f32{
let a2=alphaG*alphaG;
let gl=NdotL*sqrt(NdotV*(NdotV-a2*NdotV)+a2);
let gv=NdotV*sqrt(NdotL*(NdotL-a2*NdotL)+a2);
return 0.5/(gl+gv);
}
fn fresnelSchlick(cosTheta:f32,F0:vec3<f32>,F90:vec3<f32>)->vec3<f32>{
let t=1.0-cosTheta;
let t2=t*t;
return F0+(F90-F0)*(t2*t2*t);
}
`;function Po(t){var r,l,f,c;let{_hasSingleLight:s=!1,_hasMultiLight:B=!1,_singleLightWGSL:M="",_singleLightBlock:T="",_multiLightWGSL:P="",_multiLightLoop:h="",_normalMode:n="none",_hasEmissiveTexture:m=!1,_hasSpecGloss:E=!1,_hasDoubleSided:H=!1,_hasTonemap:b=!1,_fogHelper:U="",_fogBlock:A="",_acesHelpers:g="",_acesTonemapCall:v="",_hasAlphaBlend:S=!1,_hasSpecularAA:x=!1,_hasGammaAlbedo:k=!1,_hasBaseColorFactor:G=!1,_hasMorph:q=!1,_hasOcclusion:K=!1,_hasEmissiveColor:p=!1,_hasReflectanceExt:y=!1,_hasIbl:_=!1,_hasAnisotropy:w=!1,_anisoBrdfFunctions:j="",_anisoTBBlock:te="",_ext:a,_noColorOutput:D=!1,_esmShadowOutput:X=!1,_esmShadowDepthCode:ne="",_vbStrides:L}=t,W=n==="tangent",z=n==="cotangent",_e=W||z,Y=[{_name:"position",_type:"vec3<f32>",_gpuFormat:"float32x3",_arrayStride:((r=L?._p)==null?void 0:r._stride)??12},{_name:"normal",_type:"vec3<f32>",_gpuFormat:"float32x3",_arrayStride:((l=L?._n)==null?void 0:l._stride)??12}];W&&Y.push({_name:"tangent",_type:"vec4<f32>",_gpuFormat:"float32x4",_arrayStride:((f=L?._t)==null?void 0:f._stride)??16}),Y.push({_name:"uv",_type:"vec2<f32>",_gpuFormat:"float32x2",_arrayStride:((c=L?._u)==null?void 0:c._stride)??8}),a&&Y.push(...a.extraVertexAttributes);let oe=[{_name:"worldPos",_type:"vec3<f32>"},{_name:"worldNormal",_type:"vec3<f32>"}];W&&oe.push({_name:"worldTangent",_type:"vec3<f32>"},{_name:"worldBitangent",_type:"vec3<f32>"}),oe.push({_name:"uv",_type:"vec2<f32>"}),a&&oe.push(...a.extraVaryings);let le=[{_name:"world",_type:"mat4x4<f32>"}];qt(le);let ie=[{_name:"environmentIntensity",_type:"f32"},{_name:"directIntensity",_type:"f32"},{_name:"reflectance",_type:"f32"},{_name:"materialAlpha",_type:"f32"},...G?[{_name:"baseColorFactor",_type:"vec4<f32>"}]:[],{_name:"metallicFactor",_type:"f32"},{_name:"roughnessFactor",_type:"f32"},{_name:"normalScale",_type:"f32"},{_name:"lightFalloffMode",_type:"f32"},...w?[{_name:"anisotropyParams",_type:"vec4<f32>"}]:[],...a?a.extraMaterialUboFields:[]],I=(_t,Xe)=>[{_name:_t,_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:yt},{_name:Xe,_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:yt}],O=I("baseColorTexture","baseColorSampler");_e&&O.push(...I("normalTexture","normalSampler_")),O.push(...I("ormTexture","ormSampler")),a&&O.push(...a.extraBindings),m&&O.push(...I("emissiveTexture","emissiveSampler")),E&&O.push(...I("specGlossTexture","specGlossSampler")),X&&O.push({_name:"shadowParams",_type:{_kind:"uniform-buffer"},_visibility:yt});let fe=q?"morphedPos":"position",ce=q?"morphedNorm":"normal",ge=W?`let N_local=normalize(${ce});
let T_local=normalize(tangent.xyz);
let B_local=cross(N_local,T_local)*tangent.w;
out.worldTangent=(finalWorld*vec4<f32>(T_local,0.0)).xyz;
out.worldBitangent=(finalWorld*vec4<f32>(B_local,0.0)).xyz;`:"",ae=`/*SU*/
/*MU*/
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;
/*VH*/
/*VD*/
/*VO*/
@vertex fn main(
/*VP*/
) -> VertexOutput {
var out: VertexOutput;
/*VR*/
var finalWorld = mesh.world;
/*VW*/
let worldPos4 = finalWorld * vec4<f32>(${fe}, 1.0);
out.worldPos = worldPos4.xyz;
out.clipPos = scene.viewProjection * worldPos4;
out.worldNormal = (finalWorld * vec4<f32>(normalize(${ce}), 0.0)).xyz;
${ge}
out.uv = uv;
    ${a?a.vertexBodyExtra:""}/*VB*/
return out;
}`,J=a?.uvForNormal??"input.uv",re=a?.normalScaleMod??"",C=a?.normalScaleMod?"scaledNormal":"normalMapRaw",Q=a?.normalScaleMod?"scaledNormalCT":"normalMapSample",de;W?de=`let normalMapRaw=textureSample(normalTexture,normalSampler_,${J}).rgb*2.0-1.0;
${re}let normalMapNorm=normalize(${C});
let N_geom=normalize(input.worldNormal);
let TBN=mat3x3<f32>(input.worldTangent,input.worldBitangent,input.worldNormal);
var N=normalize(TBN*normalMapNorm);`:z?de=`let normalMapSample=textureSample(normalTexture,normalSampler_,${J}).rgb*2.0-1.0;
${re.replace(/normalMapRaw/g,"normalMapSample").replace(/scaledNormal/g,"scaledNormalCT")}let N_geom=normalize(input.worldNormal);
let dp1=dpdx(input.worldPos);
let dp2=dpdy(input.worldPos);
let duv1=dpdx(${J});
let duv2=dpdy(${J});
let dp2perp=cross(dp2,N_geom);
let dp1perp=cross(N_geom,dp1);
let tangent_ct=dp2perp*duv1.x+dp1perp*duv2.x;
let bitangent_ct=-(dp2perp*duv1.y+dp1perp*duv2.y);
let det=max(dot(tangent_ct,tangent_ct),dot(bitangent_ct,bitangent_ct));
let invmax=select(inverseSqrt(det),0.0,det==0.0);
let cotangentFrame=mat3x3<f32>(tangent_ct*invmax,bitangent_ct*invmax,N_geom);
var N=normalize(cotangentFrame*normalize(${Q}));`:de=`let N_geom=normalize(input.worldNormal);
var N=N_geom;`;let Ve=w?te:"",Te=a?.baseColorMod??"",Le=G?"*material.baseColorFactor.rgb":"",Ce=G?"*material.baseColorFactor.a":"",Fe=k?`var baseColor=pow(baseColorSample.rgb,vec3<f32>(2.2))${Le};
var alpha=baseColorSample.a${Ce};${Te}`:`var baseColor=baseColorSample.rgb${Le};
var alpha=baseColorSample.a${Ce};${Te}`,He=a?.uvForSpecGloss??"input.uv",Ue=E?`let specGloss=textureSample(specGlossTexture,specGlossSampler,${He});
let roughness=clamp(1.0-specGloss.a,0.0,1.0);
let metallic=0.0;`:`let roughness=clamp(orm.g*material.roughnessFactor,0.0,1.0);
let metallic=orm.b*material.metallicFactor;`,ke=a?.uvForEmissive??"input.uv",De=p||!m?"var emissive:vec3f;":`let emissive=textureSample(emissiveTexture,emissiveSampler,${ke}).rgb;`,it=y?"":a?.occlusionOverride?a.occlusionOverride:K?"let occlusion=orm.r;":"let occlusion=1.0;",o=y?"":E?`var colorF0=specGloss.rgb;
let colorF90=vec3<f32>(1.0);
let maxSpecular=max(colorF0.r,max(colorF0.g,colorF0.b));
let surfaceAlbedo=baseColor*(1.0-maxSpecular);`:`let dielectricF0=material.reflectance;
var colorF0=mix(vec3<f32>(dielectricF0),baseColor,metallic);
let colorF90=vec3<f32>(1.0);
let surfaceAlbedo=baseColor*(1.0-dielectricF0)*(1.0-metallic);`,e=x||_e?`var AA_factor_x=0.0;
var AA_factor_y=0.0;
{let nDfdx_AA=dpdx(N);
let nDfdy_AA=dpdy(N);
let slopeSquare_AA=max(dot(nDfdx_AA,nDfdx_AA),dot(nDfdy_AA,nDfdy_AA));
AA_factor_x=pow(saturate(slopeSquare_AA),0.333);
AA_factor_y=sqrt(slopeSquare_AA)*0.75;
alphaG+=AA_factor_y;}`:`var AA_factor_x=0.0;
var AA_factor_y=0.0;`,u=B?h:s?T:`var directDiffuse=vec3<f32>(0.0);
var directSpecular=vec3<f32>(0.0);
/*BL*/`,Z=b&&v!=="",We=Z?g:"",ze=b?Z?v:`color*=scene.vImageInfos.x;
color=1.0-exp2(-1.590579*color);`:"color*=scene.vImageInfos.x;",N=U,qe=A,ct=D?"":S?`var finalAlpha=alpha*material.materialAlpha;
var luminanceOverAlpha=0.0;
/*BA*/
luminanceOverAlpha+=dot(${_?"finalSpecularScaled":"directSpecular"},vec3<f32>(0.2126,0.7152,0.0722));
finalAlpha=saturate(finalAlpha+luminanceOverAlpha*luminanceOverAlpha);
return vec4<f32>(color,finalAlpha);`:"return vec4<f32>(color,alpha*material.materialAlpha);",Me=H?`@fragment fn main(input: FragmentInput, @builtin(front_facing) frontFacing: bool)${D?"":" -> @location(0) vec4<f32>"} {`:`@fragment fn main(input: FragmentInput)${D?"":" -> @location(0) vec4<f32>"} {`,Pe=H?"if (!frontFacing) { N = -N; }":"",Ke=B?P:s?M:"",ve=s||B?"@group(0) @binding(1) var<uniform> lights: lightsUniforms;":"",se=s||B?Kt("mesh"):"",Lt=w?j:"",Ne=a?.fragmentHelpers??"",Ee=a?.fragmentPrelude??"",je=a?.uvForBaseColor??"input.uv",ue=a?.uvForOrm??"input.uv",ut=`/*SU*/
${X?"struct shadowParamsUniforms { biasAndScale: vec4<f32>, depthValues: vec4<f32>, }":""}
/*MU*/
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;
/*HF*/
/*FB*/
/*FI*/
${Mo}
${We}
${N}
${Lt}
${Ke}
${ve}
${se}
${Ne}
${Me}
${Ee}/*SV*/
let baseColorSample=textureSample(baseColorTexture,baseColorSampler,${je});
${Fe}
let orm=textureSample(ormTexture,ormSampler,${ue}).rgb;
${it}
${Ue}
${De}
/*AT*/
${D?"return;":X?ne:`${de}
${Pe}
${Ve}
/*AC*/
let V=normalize(scene.vEyePosition.xyz-input.worldPos);
let NdotVUnclamped=dot(N,V);
let NdotV=abs(NdotVUnclamped)+0.0000001;
${o}
/*MF*/
var alphaG=roughness*roughness+0.0005;
${e}
${u}
var color=directDiffuse+directSpecular+emissive;
/*AI*/
/*NI*/
${qe}
${ze}
color=pow(color,vec3<f32>(1.0/2.2));
color=clamp(color,vec3<f32>(0.0),vec3<f32>(1.0));
let highContrast=color*color*(3.0-2.0*color);
if(scene.vImageInfos.y<1.0){color=mix(vec3<f32>(0.5),color,scene.vImageInfos.y);}
else{color=mix(color,highContrast,scene.vImageInfos.y-1.0);}
color=max(color,vec3<f32>(0.0));
/*BC*/
${ct}`}
}`;return{_vertexTemplate:ae,_fragmentTemplate:ut,_baseMeshUboFields:le,_baseMaterialUboFields:ie,_baseVertexAttributes:Y,_baseVaryings:oe,_baseBindings:O}}function No(t){let r=new Map,{_singleLightWGSL:l,_getSingleLightBlock:f,_multiLightWGSL:c,_multiLightLoop:s,_acesHelpers:B,_acesTonemapCall:M,_fogHelper:T,_fogBlock:P,_createPbrTemplateExt:h,_anisoExt:n,_iblSkyboxCalc:m,_createPbrShadowFragment:E,_shadowLights:H,_createThinInstanceFragment:b}=t;return function(A,g=0,v=0,S=0,x=0,k="",G="",q,K=""){let p=`${A}:${g}:${v}:${S}:${x}:${k}${K}`,y=r.get(p);if(y)return y;let _=C=>(A&C)!==0,w=C=>(v&C)!==0,j=C=>(S&C)!==0,te=_(we)&&w($e),a=_(we)&&!w($e),D=te||a,X=_(Jt|Qt)||(g&lo)!==0,ne=j(gt),L=w(fo),W=w(po),z=_(ao),_e=_(to),Y=_(ht),oe=w(xt),le=(g&no)!==0,ie=w(At),I=(g&st)!==0&&w(nt),O=le||ie||I,fe=_(eo),ce=O&&h?h({_hasUvTransform:le,_hasVertexColor:ie,_hasUv2:I,_hasOcclusionUv2:I,_hasAnyNormal:D,_hasEmissiveTexture:Y,_hasSpecGloss:_(rt)}):void 0,ge=Po({_hasSingleLight:x===1,_hasMultiLight:x===2,_singleLightWGSL:l,_singleLightBlock:x===1&&f?f(k):"",_multiLightWGSL:c,_multiLightLoop:s,_normalMode:te?"tangent":a?"cotangent":"none",_hasEmissiveTexture:Y,_hasSpecGloss:_(rt),_hasDoubleSided:_(St),_hasTonemap:j(vt),_fogHelper:j(ot)?T:"",_fogBlock:j(ot)?P:"",_acesHelpers:B,_acesTonemapCall:M,_hasAlphaBlend:_(at),_hasSpecularAA:fe,_hasGammaAlbedo:_(oo),_hasBaseColorFactor:(g&io)!==0,_hasMorph:L,_hasOcclusion:_(Zt)&&!X,_hasEmissiveColor:_e,_hasReflectanceExt:X,_hasIbl:ne,_hasAnisotropy:z,_anisoBrdfFunctions:z&&n?n.ANISO_BRDF_FUNCTIONS:"",_anisoTBBlock:z&&n?n.makeAnisotropyTBBlock(te):"",_ext:ce,_noColorOutput:(g&Oe)!==0,_esmShadowOutput:(g&he)!==0,_esmShadowDepthCode:G,_vbStrides:q}),ae=[],J={_features:A,_features2:g,_meshFeatures:v,_hasIbl:ne,_hasAnyNormal:D,_hasSpecularAA:fe,_anisoBentNormalCode:z&&n?n.ANISO_BENT_NORMAL:"",_iblSkyboxCalc:_(ro)?m:""};for(let C of bt().values())if(C.frag){let Q=C.frag(J);Q&&ae.push(Q)}if(W&&E){let C=H.map(Q=>({lightIndex:Q.lightIndex,shadowType:Q.shadowType}));ae.push(E(C))}oe&&b&&ae.push(b(w(Bt)));let re=Ht(ge,ae);return r.set(p,re),re}}async function Eo(t,r,l){var f,c,s,B,M,T,P,h;let n=t.surface.engine,m=n._device,E=new Map,H=!!l,b=[];for(let o=0;o<t.lights.length;o++){let e=t.lights[o].shadowGenerator;e&&b.push({lightIndex:o,shadowType:e._shadowType,gen:e})}let U=b.length>0,A=!1,g=!1,v=!1,S=[];for(let o of r){let e=Ie(o,t.lights),u=e>0?1:-e;if(A||(A=u>0),u===1&&!(o.receiveShadows&&U)){g=!0;let Z=go(t.lights,e-1);S.includes(Z)||S.push(Z)}else u>0&&(v=!0)}let x=!1,k=!1,G=!1,q=!1,K=!1,p=!1,y=!1,_=!1,w=!1,j=!1,te=!1,a=!1,D=!1,X=!1,ne=!1,L=!1,W=!1,z=!1;for(let o=0;o<r.length;o++){let e=r[o],u=e.material,Z=((c=(f=u.subsurface)==null?void 0:f.refraction)==null?void 0:c.intensity)??0;x||(x=!!u.skyboxMode),k||(k=!!(u.metallicReflectanceTexture||u.reflectanceTexture||u._hasReflExt)),G||(G=!!((s=u.clearCoat)!=null&&s.isEnabled)),q||(q=!!((B=u.sheen)!=null&&B.isEnabled)),K||(K=!!((M=u.iridescence)!=null&&M.isEnabled)),p||(p=!!((T=u.anisotropy)!=null&&T.isEnabled)),y||(y=!!((P=u.subsurface)!=null&&P.translucency)),_||(_=u.alphaCutOff>0),w||(w=Z>0&&!!u.transmissive),j||(j=!!u.emissiveColor),te||(te=!!e.skeleton),a||(a=!!e.morphTargets),D||(D=!!e.thinInstances),X||(X=!!((h=e.thinInstances)!=null&&h._gpuCullingEnabled)),ne||(ne=!!u.unlit),L||(L=!!u._hasUvTx),W||(W=!!e._gpu.uv2Buffer&&u.occlusionTexCoord===1),z||(z=!!e._gpu.colorBuffer)}let _e="";if(H){let o=await import("./ibl-fragment-DqQVi8k0-3R4CKCKV.js");Re(o.pbrExt),x&&(_e=(await import("./ibl-skybox-wgsl-DCah0kWV-FHKT6ARY.js")).IBL_SKYBOX_CALCULATION)}let Y=null,oe="",le=null,ie={},I="",O="";if(g){for(let o of S){let e=await Go(o);oe=e.SINGLE_LIGHT_STRUCTS,ie[o]=e.getSingleLightBlock}le=o=>{var e;return((e=ie[So(o)])==null?void 0:e.call(ie))??""}}if(v){let o=await import("./multilight-wgsl-74aXpcJG-72DPTTCC.js");I=o.MULTI_LIGHT_STRUCTS()+o.COMPUTE_PBR_LIGHT,O=o.getMultiLightLoop()}A&&U&&(Y=(await import("./pbr-shadow-fragment-DmnNe6yz-4PIPJU5R.js")).createPbrShadowFragment);let fe=async o=>{for(let[e,u]of o)e&&Re((await u()).pbrExt)};await fe([[_,()=>import("./alpha-test-fragment-eUG971h3-KSA3QHZZ.js")],[k,()=>import("./reflectance-fragment-CExe6qDY-33D2LL6Q.js")],[G,()=>import("./clearcoat-fragment-CHYw8MPB-R6IUHDYH.js")],[q,()=>import("./sheen-fragment-BEigjpTX-G6WGVKFV.js")],[K,()=>import("./iridescence-fragment-S3Ko1jvC-LH6PPU5S.js")],[y,()=>import("./subsurface-fragment-DpKib445-D6SC46ZX.js")]]),w&&await(await import("./pbr-refraction-CquDP9JO-6EJOW7QP.js")).registerPbrRefraction(t,n,Re),await fe([[j,()=>import("./emissive-fragment-CZMQ0_bF-YPW5IOJP.js")],[ne,()=>import("./unlit-fragment-nc6hu3Mw-V7IRWA7R.js")],[te,()=>import("./skeleton-fragment-B__bUbPK-4NKDM3JG.js")],[a,()=>import("./morph-fragment-D9he3Ksk-LNPSLYKA.js")],[L,()=>import("./uv-transform-fragment-hYujGpZg-BE35SAA6.js")]]);let ce=null;p&&(ce=await import("./anisotropy-fragment-HgasXS7l-OUFQ57BY.js"),Re(ce.pbrExt));let ge=null;(L||z||W)&&(ge=(await import("./pbr-template-ext-CGgB2n2y-73KFZ2AY.js")).createPbrTemplateExt);let ae=null,J=null,re,C=null;if(D){ae=(await import("./thin-instance-fragment-hsv-RyDs-FWP7UWCF.js")).createThinInstanceFragment;let e=await import("./thin-instance-gpu-uY2NOv0J-TBDHQLNN.js");J=e.syncThinInstanceBuffers,X&&(re=await import("./thin-instance-cull-binding-DwZi7mlE-5UIYGN73.js")),C=e.syncThinInstanceGpuData}let Q="",de="",Ve=t.imageProcessing.toneMappingEnabled;if(Ve&&t.imageProcessing.toneMappingType==="aces"){let o=await import("./pbr-aces-wgsl-HpiQHGN_-PTZQL5B3.js");Q=o.ACES_HELPERS_WGSL,de=o.ACES_TONEMAP_CALL_WGSL}let Te="",Le="";if(t.fog){let o=await import("./pbr-fog-wgsl-BqdCid6r-A4YRYJ6C.js");Te=o.PBR_FOG_HELPER,Le=o.PBR_FOG_BLOCK}let Ce=No({_singleLightWGSL:oe,_getSingleLightBlock:le,_multiLightWGSL:I,_multiLightLoop:O,_acesHelpers:Q,_acesTonemapCall:de,_fogHelper:Te,_fogBlock:Le,_createPbrTemplateExt:ge,_anisoExt:ce,_iblSkyboxCalc:_e,_createPbrShadowFragment:Y,_shadowLights:b,_createThinInstanceFragment:ae}),Fe=(H?gt:0)|(Ve?vt:0)|(t.fog?ot:0),He=new Map,Ue=J,ke=C,De=(o,e,u)=>{var Z,We;let ze=u??e.material,N=ze,qe=N._renderFeatures??(N._renderFeatures=uo(N)),ct=u!=null,Me=e,Pe=Ie(e,o.lights),Ke=Pe>0?1:-Pe,ve=qe.features,se=qe.features2??0,Ne=!((se&(Oe|he))!==0)&&e.receiveShadows&&U,Ee=Ke===0?0:Ke===1&&!Ne?1:2,je=Ee===1?go(o.lights,Pe-1):"",ue=mo(e,Ne),ut=(se&he)!==0?N._esmShadowDepthCode:"",_t=Me._gpu._vbLayout,Xe=Me._gpu._vbKey??"",Ge=Ce(ve,se,ue,Fe,Ee,je,ut,_t,Xe),pe=Co(n,ve,se,ue,Fe,Ge,`${Ee}:${je}${Xe}`),Se=new tt(Ge._meshUboSpec._totalBytes/4),Ct=((Z=n._makePackMeshWorld)==null?void 0:Z.call(n,o))??zt;Ct(Se,e.worldMatrix,0,0),Ie(e,o.lights,Se);let Ye=mt(n,Se),be=Ge._materialUboSpec,Ft=new tt(be._totalBytes/4);Tt(Ft,N,be);let Je=mt(n,Ft),xe=!!N.transmissive&&(se&so)!==0,bo=xe?null:ho(n,pe,Ge,Ye,Je,N,l??null,e),ft=null,Mt=Ne?b:[];if(Mt.length>0&&pe._shadowBGL){let i=He.get(pe._shadowBGL);if(!i){let R=[],d=0;for(let Ae of Mt){let ee=Ae.gen;R.push({binding:d++,resource:ee._depthTexture.createView()}),R.push({binding:d++,resource:ee._depthSampler}),R.push({binding:d++,resource:{buffer:ee._shadowUBO}})}i=m.createBindGroup({layout:pe._shadowBGL,entries:R}),He.set(pe._shadowBGL,i)}ft=i}let Pt=_o(N);for(let i of Pt)jt(i);o._meshDisposables.set(e,[()=>{Ye.destroy(),Je.destroy()},()=>{for(let i of Pt)Xt(i)}]);let Qe=(se&(Oe|he))===0&&(ve&at)!==0,xo=e.renderOrder??(Qe||xe?150:100),Bo=(ve&we)!==0,Ao=(se&st)!==0&&(ue&nt)!==0,yo=(ue&At)!==0,Nt=(ue&xt)!==0,dt=(ue&Bt)!==0,pt=e.worldMatrixVersion,Et=o.lights.length,Be=Qe||xe?[e.worldMatrix[12],e.worldMatrix[13],e.worldMatrix[14]]:null,Gt=()=>{let i=e.worldMatrixVersion;(i!==pt||o.lights.length!==Et)&&(Be&&(Be[0]=e.worldMatrix[12],Be[1]=e.worldMatrix[13],Be[2]=e.worldMatrix[14]),Ct(Se,e.worldMatrix,0,0),Ie(e,o.lights,Se),m.queue.writeBuffer(Ye,0,Se),pt=i,Et=o.lights.length);let R=N._uboVersion;if(R!==Ot){Ot=R;let d=E.get(be._totalBytes);d?d.fill(0):(d=new tt(be._totalBytes/4),E.set(be._totalBytes,d)),Tt(d,N,be),m.queue.writeBuffer(Je,0,d.buffer,0,d.byteLength)}if(Nt&&ke){let d=e.thinInstances;d&&ke(n,d,dt)}},wo=()=>{pt=-1},It=((We=n._wrapRenderableForFO)==null?void 0:We.call(n,Gt,o,wo))??Gt,To=(i,R,d)=>{var Ae,ee,et,Rt,$t,Vt;if(!ct&&e.material!==ze)return 0;let F=Me._gpu;i.setBindGroup(1,R),ft&&i.setBindGroup(2,ft);let $=0,V=F._vbLayout;i.setVertexBuffer($++,F.positionBuffer,(Ae=V?._p)==null?void 0:Ae._offset),i.setVertexBuffer($++,F.normalBuffer,(ee=V?._n)==null?void 0:ee._offset),Bo&&F.tangentBuffer&&i.setVertexBuffer($++,F.tangentBuffer,(et=V?._t)==null?void 0:et._offset),i.setVertexBuffer($++,F.uvBuffer,(Rt=V?._u)==null?void 0:Rt._offset),Ao&&F.uv2Buffer&&i.setVertexBuffer($++,F.uv2Buffer,($t=V?._u2)==null?void 0:$t._offset),yo&&F.colorBuffer&&i.setVertexBuffer($++,F.colorBuffer,(Vt=V?._c)==null?void 0:Vt._offset);let me=e.skeleton??e.vat;me&&(i.setVertexBuffer($++,me.jointsBuffer),i.setVertexBuffer($++,me.weightsBuffer),me.joints1Buffer&&me.weights1Buffer&&(i.setVertexBuffer($++,me.joints1Buffer),i.setVertexBuffer($++,me.weights1Buffer)));let ye=Nt?e.thinInstances:null;return ye&&Ue&&($=Ue(n,ye,i,$,dt,d?.cullDrawBufs)),i.setIndexBuffer(F.indexBuffer,F.indexFormat),d?d.draw(i,F.indexCount,ye.count):ye&&ye.count>0?i.drawIndexed(F.indexCount,ye.count):i.drawIndexed(F.indexCount),1},Ze={order:xo,isTransparent:Qe,_transmissive:xe,mesh:e,bind(i,R){let d=Fo(i,R,pe),Ae=xe?ho(n,pe,Ge,Ye,Je,N,l??null,e,R._transmissionTexture):bo,ee=re?.tryBind(Ze,o,e,n,dt,Qe||xe,It);return{renderable:Ze,pipeline:d,update:ee?ee.update:It,draw:et=>To(et,Ae,ee)}}};Be&&(Ze._worldCenter=Be);let Ot=N._uboVersion;return Ze},it=r.map(o=>De(t,o));return t._pbrGeomContext={_composePbr:Ce,_sceneFeatures:Fe,_envTextures:l??null,_shadowLights:b,_syncThinInstanceBuffers:J},t._disposables.push(()=>Lo(),()=>Yt(n)),{renderables:it,rebuildSingle:De}}function So(t){return t==="hemispheric"||t==="directional"||t==="spot"?t:"point"}function go(t,r){let l=0;for(let f of t)if(f._writeLightUbo){if(l===r)return So(f.lightType);l++}return"point"}async function Go(t){return t==="hemispheric"?import("./singlelight-hemispheric-wgsl-DL-jpc97-ZJTY6AMC.js"):t==="directional"?import("./singlelight-directional-wgsl-Ccsk-ys3-KXCK2BC4.js"):t==="spot"?import("./singlelight-spot-wgsl-DSjp1p1C-3GBCUUGM.js"):import("./singlelight-point-wgsl-hYmiP6ys-TCK7YTVW.js")}function Tt(t,r,l){t[0]=r.environmentIntensity??1,t[1]=r.directIntensity??1,t[2]=r.reflectance??.04,t[3]=r.alpha??1;let f=l._offsets.get("baseColorFactor");if(f!==void 0){let c=f/4,s=r.baseColorFactor;t[c]=s?s[0]:1,t[c+1]=s?s[1]:1,t[c+2]=s?s[2]:1,t[c+3]=s?s[3]:1}if(l._offsets.has("metallicFactor")){let c=l._offsets.get("metallicFactor")/4;t[c]=r.metallicFactor??1,t[c+1]=r.roughnessFactor??1,t[c+2]=r.normalTextureScale??1,t[c+3]=r.usePhysicalLightFalloff===!1?0:1}for(let c of bt().values())c.writeUbo&&c.writeUbo(t,r,l._offsets)}var Ro=Object.freeze(Object.defineProperty({__proto__:null,_writeMaterialData:Tt,buildPbrRenderables:Eo},Symbol.toStringTag,{value:"Module"}));export{ho as a,Tt as b,Ro as c};
