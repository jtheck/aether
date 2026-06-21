var u="nme_heightToNormal",f=`
fn nme_heightToNormal(height: f32, position: vec3<f32>, tangent: vec3<f32>, normal: vec3<f32>, generateInWorldSpace: bool, normalizeNormal: bool, normalizeTangent: bool) -> vec4<f32> {
    let norm = select(normal, normalize(normal), normalizeNormal);
    let tgt = select(tangent, normalize(tangent), normalizeTangent);
    let worlddX = dpdx(position);
    let worlddY = dpdy(position);
    let crossX = cross(norm, worlddX);
    let crossY = cross(worlddY, norm);
    let d = abs(dot(crossY, worlddX));
    var inToNormal = (((height + dpdx(height)) - height) * crossY + ((height + dpdy(height)) - height) * crossX) * sign(d);
    inToNormal.y = -inToNormal.y;
    var result = normalize(d * norm - inToNormal);
    if (!generateInWorldSpace) {
        let biTangent = cross(norm, tgt);
        let tbn = mat3x3<f32>(tgt, biTangent, norm);
        result = tbn * result;
        result = result * vec3<f32>(0.5) + vec3<f32>(0.5);
    }
    return vec4<f32>(result, 0.0);
}
`;function i(e,t){return(typeof e=="boolean"?e:t)?"true":"false"}function v(e,t,o,r){let n=t==="vertex"?o.vertex:o.fragment,l=`_heightToNormal_${e.id}`,s=n.memo.get(l);if(s)return s;o.fragment.helpers.set(u,f);let d=r.cast(r.resolve(e,"input",t,o),"f32").expr,c=r.cast(r.resolve(e,"worldPosition",t,o),"vec3f").expr,h=r.cast(r.resolve(e,"worldNormal",t,o),"vec3f").expr,a=e.inputs.get("worldTangent");if(!(e.serialized.generateInWorldSpace===!0)&&!a?.source)throw new Error(`NodeMaterial: HeightToNormalBlock "${e.name}" requires worldTangent when generateInWorldSpace is false`);let p=a?.source?r.cast(r.resolve(e,"worldTangent",t,o),"vec3f").expr:"vec3<f32>(0.0)",m=`_hn${r.temp(o,"heightNormal")}`;n.body.push(`let ${m} = nme_heightToNormal(${d}, ${c}, ${p}, ${h}, ${i(e.serialized.generateInWorldSpace,!1)}, ${i(e.serialized.automaticNormalizationNormal,!0)}, ${i(e.serialized.automaticNormalizationTangent,!0)});`);let g={expr:m,type:"vec4f"};return n.memo.set(l,g),g}var T={className:"HeightToNormalBlock",stage:"fragment",emit(e,t,o,r,n){let l=v(e,o,r,n);return t==="xyz"?{expr:`${l.expr}.xyz`,type:"vec3f"}:l}};export{T as emitter};
