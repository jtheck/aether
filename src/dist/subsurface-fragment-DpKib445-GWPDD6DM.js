import{fc as _,gc as i,qc as b}from"./chunk-ZBW7LZ4P.js";var v=`
fn transmittanceBRDF_Burley(tintColor: vec3<f32>, diffusionDistance: vec3<f32>, thickness: f32) -> vec3<f32> {
let S = 1.0 / max(vec3<f32>(0.000001), diffusionDistance);
let temp = exp((-0.333333333 * thickness) * S);
return tintColor * 0.25 * (temp * temp * temp + 3.0 * temp);
}
fn computeWrappedDiffuseNdotL(NdotL: f32, w: f32) -> f32 {
let t = 1.0 + w;
let invt2 = 1.0 / (t * t);
return saturate((NdotL + w) * invt2);
}
`,S=`var translucencyDirect = vec3<f32>(0.0);
var ssTransmittance = vec3<f32>(0.0);
var ssIntensity = 0.0;`;function d(e,r){return`${e?`let thicknessSample = textureSample(thicknessTexture_, thicknessSampler_, input.uv).${r?"g":"r"};`:"let thicknessSample = 1.0;"}
let ssThickness = max(material.subsurfaceParams.y + thicknessSample * material.subsurfaceParams.z, 0.000001);
let ssTranslucencyColor = material.subsurfaceParams3.rgb;
let ssDiffDist = material.subsurfaceParams2.rgb;
ssIntensity = material.subsurfaceParams.x;
ssTransmittance = transmittanceBRDF_Burley(ssTranslucencyColor, ssDiffDist, ssThickness) * ssIntensity;`}var h=`{
let NdotLU = dot(N, L);
if (NdotLU < 0.0) {
let wrapNdotL = computeWrappedDiffuseNdotL(abs(NdotLU), 0.02);
translucencyDirect += (1.0 / PI) * wrapNdotL * ssTransmittance * lightAtten * lightColor * material.directIntensity;
}
}`,k=`{
let N_back = -N_env;
let envIrrBack = (scene.vSphericalL00.rgb
  + scene.vSphericalL1_1.rgb * N_back.y + scene.vSphericalL10.rgb * N_back.z + scene.vSphericalL11.rgb * N_back.x
  + scene.vSphericalL2_2.rgb * (N_back.y * N_back.x) + scene.vSphericalL2_1.rgb * (N_back.y * N_back.z)
  + scene.vSphericalL20.rgb * (3.0 * N_back.z * N_back.z - 1.0) + scene.vSphericalL21.rgb * (N_back.z * N_back.x)
  + scene.vSphericalL22.rgb * (N_back.x * N_back.x - N_back.y * N_back.y)) * material.environmentIntensity;
let refractionIrradiance = envIrrBack * ssTransmittance;
color -= finalIrradiance * ssIntensity;
color += refractionIrradiance * occlusion;
color -= directDiffuse * ssIntensity;
color += translucencyDirect * occlusion;
}`,y=`color -= directDiffuse * ssIntensity;
color += translucencyDirect;`,m=2;function N(e,r,t){let n=e?[{_name:"thicknessTexture_",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:m},{_name:"thicknessSampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:m}]:[],s={SV:S,AT:d(e,t),AD:h};r?s.AI=k:s.NI=y;let c=[];return r&&c.push("ibl"),{_id:"subsurface",_dependencies:c.length>0?c:void 0,_bindings:n.length>0?n:void 0,_uboFields:[{_name:"subsurfaceParams",_type:"vec4<f32>"},{_name:"subsurfaceParams2",_type:"vec4<f32>"},{_name:"subsurfaceParams3",_type:"vec4<f32>"}],_helperFunctions:v,_fragmentSlots:s}}function g(e,r,t){let n=r.translucency,s=r.thickness,c=t.get("subsurfaceParams")/4;e[c]=n.intensity??1;let a=s?.min??0,p=s?.max??1;e[c+1]=a,e[c+2]=p-a;let u=t.get("subsurfaceParams2")/4,l=n.diffusionDistance??[1,1,1];e[u]=l[0],e[u+1]=l[1],e[u+2]=l[2];let o=t.get("subsurfaceParams3")/4,f=n.color??[1,1,1];e[o]=f[0],e[o+1]=f[1],e[o+2]=f[2]}var x={id:"subsurface",phase:"fragment",detect(e){var r,t,n;let s=e;if(!((r=s.subsurface)!=null&&r.translucency))return{f:0,f2:0};let c=_,a=0;return(t=s.subsurface.thickness)!=null&&t.texture&&(c|=i),(n=s.subsurface.thickness)!=null&&n.useGlTFChannel&&(a|=b),{f:c,f2:a}},frag(e){return e._features&_?N((e._features&i)!==0,e._hasIbl,(e._features2&b)!==0):null},writeUbo(e,r,t){var n;let s=r;(n=s.subsurface)!=null&&n.translucency&&t.has("subsurfaceParams")&&g(e,s.subsurface,t)},bind(e,r,t){var n,s;if((e._features&i)!==0){let c=(s=(n=e._material.subsurface)==null?void 0:n.thickness)==null?void 0:s.texture;c&&(r.push({binding:t++,resource:c.view}),r.push({binding:t++,resource:c.sampler}))}return t},textures(e,r){var t,n;let s=(n=(t=e.subsurface)==null?void 0:t.thickness)==null?void 0:n.texture;s&&r.push(s)}};export{N as createSubsurfaceFragment,x as pbrExt,g as writeSubsurfaceUBO};
