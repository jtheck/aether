var p=`fn nme_computeFresnelTerm(viewDirection: vec3<f32>, worldNormal: vec3<f32>, bias: f32, power: f32) -> f32 {
    let fresnelTerm = pow(bias + abs(dot(viewDirection, worldNormal)), power);
    return clamp(fresnelTerm, 0.0, 1.0);
}`,f={className:"FresnelBlock",emit(n,t,o,r,e){let s=e.cast(e.resolve(n,"worldNormal",o,r),"vec3f").expr,m=e.cast(e.resolve(n,"viewDirection",o,r),"vec3f").expr,l=e.cast(e.resolve(n,"bias",o,r),"f32").expr,i=e.cast(e.resolve(n,"power",o,r),"f32").expr;return(o==="vertex"?r.vertex:r.fragment).helpers.set("nme_computeFresnelTerm",p),{expr:`nme_computeFresnelTerm(${m}, ${s}, ${l}, ${i})`,type:"f32"}}};export{f as emitter};
