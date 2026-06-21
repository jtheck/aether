var i="nme_fog",p=`
fn nme_fogFactor(worldPos: vec3<f32>, cameraPos: vec3<f32>, fogParams: vec4<f32>) -> f32 {
    let dist = distance(worldPos, cameraPos);
    let mode = fogParams.x;
    let density = fogParams.y;
    let fstart = fogParams.z;
    let fend = fogParams.w;
    // mode: 1=EXP, 2=EXP2, 3=LINEAR
    if (mode < 1.5) {
        return clamp(exp(-dist * density), 0.0, 1.0);
    }
    if (mode < 2.5) {
        let d = dist * density;
        return clamp(exp(-d * d), 0.0, 1.0);
    }
    return clamp((fend - dist) / (fend - fstart), 0.0, 1.0);
}
`,v={className:"FogBlock",stage:"fragment",emit(t,l,r,o,e){o.fragment.helpers.set(i,p);let n=e.cast(e.resolve(t,"worldPosition",r,o),"vec3f").expr,f=e.resolve(t,"input",r,o),c=e.cast(e.resolve(t,"fogColor",r,o),"vec3f").expr,a=f.type==="vec4f"?"vec4f":"vec3f",m=e.cast(f,"vec3f").expr,d=`nme_fogFactor(${n}, _NME_CAMERA_POS_, _NME_FOG_PARAMS_)`,s=`mix(${c}, ${m}, ${d})`;return a==="vec4f"?{expr:`vec4<f32>(${s}, (${f.expr}).w)`,type:"vec4f"}:{expr:s,type:"vec3f"}}};export{v as emitter};
