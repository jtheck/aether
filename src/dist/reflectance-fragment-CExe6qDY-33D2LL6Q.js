import{Wb as i,Xb as n,Yb as s,tc as m,uc as f}from"./chunk-LFLB3D3T.js";var o=2;function p(r,e,t){if(!t.has("occlusionStrength"))return;let l=t.get("occlusionStrength")/4;r[l]=e.occlusionStrength??1,r[l+1]=e.metallicF0Factor??1,r[l+2]=e.specularWeight??e.metallicF0Factor??1;let c=e.metallicReflectanceColor;r[l+4]=c?c[0]:1,r[l+5]=c?c[1]:1,r[l+6]=c?c[2]:1}function _(r,e,t,l=!1){let c=[];r&&c.push({_name:"metallicReflectanceMap",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:o},{_name:"metallicReflectanceMapSampler",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:o}),e&&c.push({_name:"reflectanceMap",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:o},{_name:"reflectanceMapSampler",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:o});let a=`var mrFactors = vec4<f32>(material.metallicReflectanceColor, material.metallicF0Factor);
var specularWeight = material.specularWeight;`;return e&&(a+=`
{ let rSample = textureSample(reflectanceMap, reflectanceMapSampler, input.uv);
  let rLinear = pow(rSample.rgb, vec3<f32>(2.2));
  mrFactors = vec4<f32>(mrFactors.rgb * rLinear, mrFactors.a); }`),r&&(t?a+=`
{ let mrSample = textureSample(metallicReflectanceMap, metallicReflectanceMapSampler, input.uv);
  mrFactors = vec4<f32>(mrFactors.rgb, mrFactors.a * mrSample.a);
  specularWeight *= mrSample.a; }`:a+=`
{ let mrSample = textureSample(metallicReflectanceMap, metallicReflectanceMapSampler, input.uv);
  let mrLinear = pow(mrSample.rgb, vec3<f32>(2.2));
  mrFactors = vec4<f32>(mrFactors.rgb * mrLinear, mrFactors.a * mrSample.a);
  specularWeight *= mrSample.a; }`),a+=`
let dielectricF0 = material.reflectance * mrFactors.a;
let surfaceReflectivityColor = mrFactors.rgb;
let dielectricColorF0 = vec3<f32>(dielectricF0) * surfaceReflectivityColor;
let metallicColorF0 = baseColor;
var colorF0 = mix(dielectricColorF0, metallicColorF0, metallic);
let colorF90 = vec3<f32>(mix(specularWeight, 1.0, metallic));
let surfaceAlbedo = baseColor * (vec3<f32>(1.0) - vec3<f32>(dielectricF0) * surfaceReflectivityColor) * (1.0 - metallic);`,{_id:"reflectance",_uboFields:[{_name:"occlusionStrength",_type:"f32"},{_name:"metallicF0Factor",_type:"f32"},{_name:"specularWeight",_type:"f32"},{_name:"_mrPad1",_type:"f32"},{_name:"metallicReflectanceColor",_type:"vec3<f32>"},{_name:"_mrPad2",_type:"f32"}],_bindings:c,_fragmentSlots:{MF:a,AT:l?"let occlusion = mix(1.0, textureSample(occlusionTexture, occlusionSampler_, input.uv2).r, material.occlusionStrength);":"let occlusion = mix(1.0, orm.r, material.occlusionStrength);"}}}var S={id:"reflectance",phase:"fragment",detect(r){let e=r,t=0,l=0;if(e.metallicReflectanceTexture&&(t|=i),e.reflectanceTexture&&(t|=n),t===0){let c=e.metallicF0Factor!=null&&Math.abs(e.metallicF0Factor-1)>1e-6,a=e.metallicReflectanceColor,u=a!=null&&(a[0]!==1||a[1]!==1||a[2]!==1);(c||u)&&(l|=m)}return(t!==0||l&m)&&e.useOnlyMetallicFromMetallicReflectanceTexture&&(t|=s),{f:t,f2:l}},frag(r){let e=(r._features&i)!==0,t=(r._features&n)!==0,l=(r._features2&m)!==0;return!e&&!t&&!l?null:_(e,t,(r._features&s)!==0,(r._features2&f)!==0)},writeUbo:p,bind(r,e,t){if((r._features&(i|n))===0)return t;let l=r._material;return l.metallicReflectanceTexture&&(e.push({binding:t++,resource:l.metallicReflectanceTexture.view}),e.push({binding:t++,resource:l.metallicReflectanceTexture.sampler})),l.reflectanceTexture&&(e.push({binding:t++,resource:l.reflectanceTexture.view}),e.push({binding:t++,resource:l.reflectanceTexture.sampler})),t},textures(r,e){let t=r;t.metallicReflectanceTexture&&e.push(t.metallicReflectanceTexture),t.reflectanceTexture&&e.push(t.reflectanceTexture)}};export{_ as createReflectanceFragment,S as pbrExt,p as writeReflectanceUBO};
