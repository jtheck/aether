function t(e){return`fn nme_apply_image_processing(inputColor: vec4<f32>) -> vec4<f32> {
    var rgb = inputColor.rgb;
    ${e?"rgb = pow(max(rgb, vec3<f32>(0.0)), vec3<f32>(2.2));":""}
    rgb = rgb * sceneU.vImageInfos.x;
    if (sceneU.vImageInfos.w > 0.5) {
        rgb = 1.0 - exp2(-1.590579 * rgb);
    }
    rgb = pow(max(rgb, vec3<f32>(0.0)), vec3<f32>(0.45454545));
    rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
    let highContrast = rgb * rgb * (vec3<f32>(3.0) - rgb * 2.0);
    if (sceneU.vImageInfos.y < 1.0) {
        rgb = mix(vec3<f32>(0.5), rgb, sceneU.vImageInfos.y);
    } else {
        rgb = mix(rgb, highContrast, sceneU.vImageInfos.y - 1.0);
    }
    return vec4<f32>(max(rgb, vec3<f32>(0.0)), inputColor.a);
}`}var f={className:"ImageProcessingBlock",stage:"fragment",emit(e,c,o,r,n){let s=e.serialized.convertInputToLinearSpace!==!1,a=`nme_image_processing_${s?"linear":"as_is"}`;r.fragment.helpers.set(a,t(s));let i=n.cast(n.resolve(e,"color",o,r),"vec4f"),g=n.temp(r,"ip");return r.fragment.body.push(`let ${g} = nme_apply_image_processing(${i.expr});`),c==="rgb"?{expr:`${g}.rgb`,type:"vec3f"}:{expr:g,type:"vec4f"}}};export{f as emitter};
