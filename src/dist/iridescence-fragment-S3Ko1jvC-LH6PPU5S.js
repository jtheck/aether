import{Ac as v,Bc as l,Cc as u,Wb as I,Xb as T,tc as x}from"./chunk-LFLB3D3T.js";var h=2,C=1<<20,F=1<<21,A=1<<22,P=1<<23,U=128,H=`const IRI_XYZ_TO_REC709:mat3x3<f32>=mat3x3<f32>(
3.2404542,-0.9692660,0.0556434,
-1.5371385,1.8760108,-0.2040259,
-0.4985314,0.0415560,1.0572252);
fn iri_square3(x:vec3<f32>)->vec3<f32>{return x*x;}
fn iri_iorFromAirF0(f0:vec3<f32>)->vec3<f32>{
let s=sqrt(clamp(f0,vec3<f32>(0.0),vec3<f32>(0.9999)));
return (vec3<f32>(1.0)+s)/(vec3<f32>(1.0)-s);
}
fn iri_r0FromIor3(iorT:vec3<f32>,iorI:f32)->vec3<f32>{return iri_square3((iorT-vec3<f32>(iorI))/(iorT+vec3<f32>(iorI)));}
fn iri_r0FromIor(iorT:f32,iorI:f32)->f32{let r=(iorT-iorI)/(iorT+iorI);return r*r;}
fn iri_fresSchlick(c:f32,F0:vec3<f32>,F90:vec3<f32>)->vec3<f32>{
let t=1.0-c;
let t2=t*t;
return F0+(F90-F0)*(t2*t2*t);
}
fn iri_evalSensitivity(opd:f32,shift:vec3<f32>)->vec3<f32>{
let phase=6.283185307179586*opd*1.0e-9;
let val=vec3<f32>(5.4856e-13,4.4201e-13,5.2481e-13);
let pos=vec3<f32>(1.6810e+06,1.7953e+06,2.2084e+06);
let vr=vec3<f32>(4.3278e+09,9.3046e+09,6.6121e+09);
var xyz=val*sqrt(6.283185307179586*vr)*cos(pos*phase+shift)*exp(-(phase*phase)*vr);
xyz.x=xyz.x+9.7470e-14*sqrt(6.283185307179586*4.5282e+09)*cos(2.2399e+06*phase+shift.x)*exp(-4.5282e+09*phase*phase);
xyz=xyz/1.0685e-7;
return IRI_XYZ_TO_REC709*xyz;
}
fn iri_eval(outsideIor:f32,eta2:f32,cosTheta1:f32,thickness:f32,baseF0:vec3<f32>)->vec3<f32>{
let iridescenceIor=mix(outsideIor,eta2,smoothstep(0.0,0.03,thickness));
let eta=outsideIor/iridescenceIor;
let sinTheta2Sq=eta*eta*(1.0-cosTheta1*cosTheta1);
let cosTheta2Sq=1.0-sinTheta2Sq;
if(cosTheta2Sq<0.0){return vec3<f32>(1.0);}
let cosTheta2=sqrt(cosTheta2Sq);
let r0=iri_r0FromIor(iridescenceIor,outsideIor);
let r12=iri_fresSchlick(cosTheta1,vec3<f32>(r0),vec3<f32>(1.0)).x;
let t121=1.0-r12;
var phi12=0.0;
if(iridescenceIor<outsideIor){phi12=3.141592653589793;}
let phi21=3.141592653589793-phi12;
let baseIor=iri_iorFromAirF0(baseF0);
let r1=iri_r0FromIor3(baseIor,iridescenceIor);
let r23=iri_fresSchlick(cosTheta2,r1,vec3<f32>(1.0));
var phi23=vec3<f32>(0.0);
if(baseIor.x<iridescenceIor){phi23.x=3.141592653589793;}
if(baseIor.y<iridescenceIor){phi23.y=3.141592653589793;}
if(baseIor.z<iridescenceIor){phi23.z=3.141592653589793;}
let opd=2.0*iridescenceIor*thickness*cosTheta2;
let phi=vec3<f32>(phi21)+phi23;
let r123=clamp(vec3<f32>(r12)*r23,vec3<f32>(1e-5),vec3<f32>(0.9999));
let smallR123=sqrt(r123);
let rs=(t121*t121)*r23/(vec3<f32>(1.0)-r123);
var outI=vec3<f32>(r12)+rs;
var cm=rs-vec3<f32>(t121);
for(var m:i32=1;m<=2;m=m+1){
cm=cm*smallR123;
outI=outI+cm*(2.0*iri_evalSensitivity(f32(m)*opd,f32(m)*phi));
}
return max(outI,vec3<f32>(0.0));
}`,S=[[l,"texture"],[u,"thicknessTexture"]];function E(e,i,r){return(e&r)!==0&&(i&U)!==0?"input.uv2":"input.uv"}function y(e,i,r){return r?`let ${e}=vec2<f32>(dot(material.${e}m.xy,${i}),dot(material.${e}m.zw,${i}))+material.${e}t.xy;`:`let ${e}=${i};`}function R(e){return[{_name:`${e}m`,_type:"vec4<f32>"},{_name:`${e}t`,_type:"vec4<f32>"}]}function k(e,i,r,s){let c=i.get(`${r}m`),f=i.get(`${r}t`);if(c===void 0||f===void 0)return;let t=c/4,n=f/4,a=s?.uScale??1,o=s?.vScale??1,_=s?.uAng??0,m=s?.uOffset??0,b=s?.vOffset??0;if(_===0)e[t]=a,e[t+1]=0,e[t+2]=0,e[t+3]=o;else{let p=Math.cos(_),d=Math.sin(_);e[t]=p*a,e[t+1]=-d*o,e[t+2]=d*a,e[t+3]=p*o}e[n]=m,e[n+1]=b,e[n+2]=0,e[n+3]=0}function N(e,i,r){if((i&v)===0)return null;let s=(i&l)!==0,c=(i&u)!==0,f=(i&C)!==0,t=(i&F)!==0,n=[],a=[{_name:"iridescenceParams",_type:"vec4<f32>"}];s&&(n.push({_name:"iridescenceTexture",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:h},{_name:"iridescenceSampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:h}),f&&a.push(...R("iridescenceUV"))),c&&(n.push({_name:"iridescenceThicknessTexture",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:h},{_name:"iridescenceThicknessSampler_",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:h}),t&&a.push(...R("iridescenceThicknessUV")));let o=[];s&&o.push(y("iridescenceUV",E(i,r,A),f)),c&&o.push(y("iridescenceThicknessUV",E(i,r,P),t));let _=s?"material.iridescenceParams.x*textureSample(iridescenceTexture,iridescenceSampler_,iridescenceUV).r":"material.iridescenceParams.x",m=c?"mix(material.iridescenceParams.z,material.iridescenceParams.w,textureSample(iridescenceThicknessTexture,iridescenceThicknessSampler_,iridescenceThicknessUV).g)":"material.iridescenceParams.w";return{_id:"iridescence",_dependencies:(e&(I|T))!==0||(i&x)!==0?["reflectance"]:void 0,_uboFields:a,_bindings:n,_helperFunctions:H,_fragmentSlots:{...o.length?{SV:o.join(`
`)}:void 0,MF:`{
let iriIntensity=clamp(${_},0.0,1.0);
let iriThickness=max(${m},0.0);
let iriF0=iri_eval(1.0,max(material.iridescenceParams.y,1.0001),NdotV,iriThickness,colorF0);
colorF0=mix(colorF0,iriF0,iriIntensity);
}`}}}function V(e,i,r){let s=i.iridescence;if(!s?.isEnabled||!r.has("iridescenceParams"))return;let c=r.get("iridescenceParams")/4;e[c]=s.intensity??1,e[c+1]=s.indexOfRefraction??1.3,e[c+2]=s.minimumThickness??100,e[c+3]=s.maximumThickness??400,k(e,r,"iridescenceUV",s.texture),k(e,r,"iridescenceThicknessUV",s.thicknessTexture)}var $={id:"iridescence",phase:"base-tex",detect(e){let i=e.iridescence;if(!i?.isEnabled)return{f:0,f2:0};let r=v;return i.texture&&(r|=l,i.texture._hasTx&&(r|=C),i.texture._texCoord===1&&(r|=A)),i.thicknessTexture&&(r|=u,i.thicknessTexture._hasTx&&(r|=F),i.thicknessTexture._texCoord===1&&(r|=P)),{f:0,f2:r}},frag:e=>N(e._features,e._features2,e._meshFeatures),writeUbo:V,bind(e,i,r){let s=e._material.iridescence;if(!s)return r;for(let[c,f]of S){let t=s[f];(e._features2&c)!==0&&t&&(i.push({binding:r++,resource:t.view}),i.push({binding:r++,resource:t.sampler}))}return r},textures(e,i){let r=e.iridescence;if(r)for(let[,s]of S){let c=r[s];c&&i.push(c)}}};export{$ as pbrExt,V as writeIridescenceUBO};
