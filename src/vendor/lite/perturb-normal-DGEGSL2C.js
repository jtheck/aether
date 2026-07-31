var a="nme_perturbNormal",v=`
fn nme_perturbNormal(worldPos: vec3<f32>, worldNormal: vec3<f32>, uv: vec2<f32>, sampled: vec3<f32>, strength: f32) -> vec3<f32> {
    // Construct ad-hoc TBN from screen-space derivatives. WebGPU's UV.y goes top-down
    // (BJS GLSL UV is bottom-up), so dpdy and duv2 both end up with opposite sign vs BJS.
    // Negating BOTH dp2 AND duv2 cancels the framebuffer Y-flip without flipping the
    // tangent orientation. This produces the same TBN as BJS does at the same fragment.
    let dp1 = dpdx(worldPos);
    let dp2 = -dpdy(worldPos);
    let duv1 = dpdx(uv);
    let duv2 = -dpdy(uv);
    let dp2perp = cross(dp2, worldNormal);
    let dp1perp = cross(worldNormal, dp1);
    let T = dp2perp * duv1.x + dp1perp * duv2.x;
    let B = dp2perp * duv1.y + dp1perp * duv2.y;
    let invmax = inverseSqrt(max(dot(T, T), dot(B, B)));
    let n = sampled * 2.0 - vec3<f32>(1.0);
    let scaled = vec3<f32>(n.xy * strength, n.z);
    return normalize(T * scaled.x * invmax + B * scaled.y * invmax + worldNormal * scaled.z);
}
`,c={className:"PerturbNormalBlock",stage:"fragment",emit(r,m,t,o,e){o.fragment.helpers.set(a,v);let p=e.cast(e.resolve(r,"worldPosition",t,o),"vec3f").expr,s=e.cast(e.resolve(r,"worldNormal",t,o),"vec3f").expr,d=e.cast(e.resolve(r,"uv",t,o),"vec2f").expr,n=e.cast(e.resolve(r,"normalMapColor",t,o),"vec3f").expr,l=r.inputs.get("strength")?.source?e.cast(e.resolve(r,"strength",t,o),"f32").expr:"1.0";return{expr:`nme_perturbNormal(${p}, ${s}, ${d}, ${n}, ${l})`,type:"vec3f"}}};export{c as emitter};
