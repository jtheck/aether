var c="nme_skinning",m=`
fn nme_skinningMatrix(indices: vec4<f32>, weights: vec4<f32>) -> mat4x4<f32> {
    let i0 = u32(indices.x);
    let i1 = u32(indices.y);
    let i2 = u32(indices.z);
    let i3 = u32(indices.w);
    return nmeBones[i0] * weights.x
         + nmeBones[i1] * weights.y
         + nmeBones[i2] * weights.z
         + nmeBones[i3] * weights.w;
}
`,w={className:"BonesBlock",stage:"vertex",emit(n,l,s,e,i){let t=i.resolve(n,"world",s,e);if(!e.hasSkeleton)return t;e.vertex.helpers.set(c,m);let r=i.cast(i.resolve(n,"matricesIndices",s,e),"vec4f").expr,o=i.cast(i.resolve(n,"matricesWeights",s,e),"vec4f").expr;return{expr:`(${t.expr} * nme_skinningMatrix(${r}, ${o}))`,type:"mat4f"}}};export{w as emitter};
