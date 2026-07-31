var S=128,m=1<<22,y=1<<23,v=1<<24,k=`
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
`,N=`var translucencyDirect = vec3<f32>(0.0);
var ssTransmittance = vec3<f32>(0.0);
var ssIntensity = 0.0;`;function x(e,c,t,n,s){let a=e?`let thicknessSample = textureSample(thicknessTexture_, thicknessSampler_, input.uv).${c?"g":"r"};`:"let thicknessSample = 1.0;",u="",i="input.uv",r="input.uv";s&&t&&(u+=`let ssColorUV = vec2<f32>(dot(material.translucencyColorUVm.xy, input.uv), dot(material.translucencyColorUVm.zw, input.uv)) + material.translucencyColorUVt.xy;
`,i="ssColorUV"),s&&n&&(u+=`let ssIntUV = vec2<f32>(dot(material.translucencyIntensityUVm.xy, input.uv), dot(material.translucencyIntensityUVm.zw, input.uv)) + material.translucencyIntensityUVt.xy;
`,r="ssIntUV");let l=t?` * textureSample(translucencyColorTexture_, translucencyColorSampler_, ${i}).rgb`:"",o=n?` * textureSample(translucencyIntensityTexture_, translucencyIntensitySampler_, ${r}).a`:"";return`${u}${a}
let ssThickness = max(material.subsurfaceParams.y + thicknessSample * material.subsurfaceParams.z, 0.000001);
let ssTranslucencyColor = material.subsurfaceParams3.rgb${l};
let ssDiffDist = material.subsurfaceParams2.rgb;
ssIntensity = material.subsurfaceParams.x${o};
ssTransmittance = transmittanceBRDF_Burley(ssTranslucencyColor, ssDiffDist, ssThickness) * ssIntensity;`}var g=`{
let NdotLU = dot(N, L);
if (NdotLU < 0.0) {
let wrapNdotL = computeWrappedDiffuseNdotL(abs(NdotLU), 0.02);
translucencyDirect += (1.0 / PI) * wrapNdotL * ssTransmittance * lightAtten * lightColor * material.directIntensity;
}
}`,d=`{
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
}`,I=`color -= directDiffuse * ssIntensity;
color += translucencyDirect;`,f=2;function C(e,c,t,n,s,_){let a={_kind:"texture",_textureType:"texture_2d<f32>"},u={_kind:"sampler",_samplerType:"sampler"},i=[];e&&i.push({_name:"thicknessTexture_",_type:a,_visibility:f},{_name:"thicknessSampler_",_type:u,_visibility:f}),n&&i.push({_name:"translucencyColorTexture_",_type:a,_visibility:f},{_name:"translucencyColorSampler_",_type:u,_visibility:f}),s&&i.push({_name:"translucencyIntensityTexture_",_type:a,_visibility:f},{_name:"translucencyIntensitySampler_",_type:u,_visibility:f});let r=[{_name:"subsurfaceParams",_type:"vec4<f32>"},{_name:"subsurfaceParams2",_type:"vec4<f32>"},{_name:"subsurfaceParams3",_type:"vec4<f32>"}];_&&n&&r.push({_name:"translucencyColorUVm",_type:"vec4<f32>"},{_name:"translucencyColorUVt",_type:"vec4<f32>"}),_&&s&&r.push({_name:"translucencyIntensityUVm",_type:"vec4<f32>"},{_name:"translucencyIntensityUVt",_type:"vec4<f32>"});let l={SV:N,AT:x(e,t,n,s,_),AD:g};c?l.AI=d:l.NI=I;let o=[];return c&&o.push("ibl"),{_id:"subsurface",_dependencies:o.length>0?o:void 0,_bindings:i.length>0?i:void 0,_uboFields:r,_helperFunctions:k,_fragmentSlots:l}}function L(e,c,t){let n=c.translucency,s=c.thickness,_=t.get("subsurfaceParams")/4;e[_]=n.intensity??1;let a=s?.min??0,u=s?.max??1;e[_+1]=a,e[_+2]=u-a;let i=t.get("subsurfaceParams2")/4,r=n.diffusionDistance??[1,1,1];e[i]=r[0],e[i+1]=r[1],e[i+2]=r[2];let l=t.get("subsurfaceParams3")/4,o=n.color??[1,1,1];e[l]=o[0],e[l+1]=o[1],e[l+2]=o[2],h(e,t,"translucencyColorUV",n.colorTexture),h(e,t,"translucencyIntensityUV",n.intensityTexture)}function h(e,c,t,n){let s=c.get(`${t}m`),_=c.get(`${t}t`);if(s===void 0||_===void 0)return;let a=n?.uScale??1,u=n?.vScale??1,i=n?.uAng??0,r=s/4;if(i===0)e[r]=a,e[r+1]=0,e[r+2]=0,e[r+3]=u;else{let o=Math.cos(i),p=Math.sin(i);e[r]=o*a,e[r+1]=p*u,e[r+2]=-p*a,e[r+3]=o*u}let l=_/4;e[l]=n?.uOffset??0,e[l+1]=n?.vOffset??0}var U={id:"subsurface",phase:"fragment",detect(e){let c=e,t=c.subsurface?.translucency;if(!t)return{f:0,f2:0};let n=134217728,s=0;return c.subsurface.thickness?.texture&&(n|=268435456),c.subsurface.thickness?.useGlTFChannel&&(s|=S),t.colorTexture&&(s|=m),t.intensityTexture&&(s|=y),(t.colorTexture?._hasTx||t.intensityTexture?._hasTx)&&(s|=v),{f:n,f2:s}},frag(e){return e._features&134217728?C((e._features&268435456)!==0,e._hasIbl,(e._features2&S)!==0,(e._features2&m)!==0,(e._features2&y)!==0,(e._features2&v)!==0):null},writeUbo(e,c,t){let n=c;n.subsurface?.translucency&&t.has("subsurfaceParams")&&L(e,n.subsurface,t)},bind(e,c,t){let n=e._material.subsurface;if((e._features&268435456)!==0){let s=n?.thickness?.texture;s&&(c.push({binding:t++,resource:s.view}),c.push({binding:t++,resource:s.sampler}))}if((e._features2&m)!==0){let s=n?.translucency?.colorTexture;s&&(c.push({binding:t++,resource:s.view}),c.push({binding:t++,resource:s.sampler}))}if((e._features2&y)!==0){let s=n?.translucency?.intensityTexture;s&&(c.push({binding:t++,resource:s.view}),c.push({binding:t++,resource:s.sampler}))}return t},textures(e,c){let t=e.subsurface;t?.thickness?.texture&&c.push(t.thickness.texture),t?.translucency?.colorTexture&&c.push(t.translucency.colorTexture),t?.translucency?.intensityTexture&&c.push(t.translucency.intensityTexture)}};export{C as createSubsurfaceFragment,U as pbrExt,L as writeSubsurfaceUBO};
