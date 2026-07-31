var d="nme_ambientOcclusion",i=`
fn nme_aoNormalFromDepth(depthTex: texture_2d<f32>, depthSamp: sampler, depth: f32, coords: vec2<f32>, radius: f32) -> vec3<f32> {
    let offset1 = vec2<f32>(0.0, radius);
    let offset2 = vec2<f32>(radius, 0.0);
    let depth1 = textureSampleLevel(depthTex, depthSamp, coords + offset1, 0.0).r;
    let depth2 = textureSampleLevel(depthTex, depthSamp, coords + offset2, 0.0).r;
    let p1 = vec3<f32>(offset1, depth1 - depth);
    let p2 = vec3<f32>(offset2, depth2 - depth);
    var normal = cross(p1, p2);
    normal.z = -normal.z;
    return normalize(normal);
}

fn nme_aoRandom(uv: vec2<f32>) -> vec3<f32> {
    let x = fract(sin(dot(uv, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    let y = fract(sin(dot(uv, vec2<f32>(39.3468, 11.135))) * 24634.6345);
    let z = fract(sin(dot(uv, vec2<f32>(73.156, 52.235))) * 12414.2347);
    return normalize(vec3<f32>(x, y, z));
}

fn nme_computeAo(depthTex: texture_2d<f32>, depthSamp: sampler, fragCoord: vec4<f32>, screenSize: vec2<f32>, radius: f32, area: f32, fallOff: f32) -> f32 {
    let uv = fragCoord.xy / screenSize;
    let random = nme_aoRandom(uv * 4.0);
    let depth = textureSampleLevel(depthTex, depthSamp, uv, 0.0).r;
    let position = vec3<f32>(uv, depth);
    let normal = nme_aoNormalFromDepth(depthTex, depthSamp, depth, uv, radius);
    let radiusDepth = radius / depth;
    let sampleSphere = array<vec3<f32>, 16>(
        vec3<f32>(0.5381, 0.1856, -0.4319), vec3<f32>(0.1379, 0.2486, 0.4430), vec3<f32>(0.3371, 0.5679, -0.0057), vec3<f32>(-0.6999, -0.0451, -0.0019),
        vec3<f32>(0.0689, -0.1598, -0.8547), vec3<f32>(0.0560, 0.0069, -0.1843), vec3<f32>(-0.0146, 0.1402, 0.0762), vec3<f32>(0.0100, -0.1924, -0.0344),
        vec3<f32>(-0.3577, -0.5301, -0.4358), vec3<f32>(-0.3169, 0.1063, 0.0158), vec3<f32>(0.0103, -0.5869, 0.0046), vec3<f32>(-0.0897, -0.4940, 0.3287),
        vec3<f32>(0.7119, -0.0154, -0.0918), vec3<f32>(-0.0533, 0.0596, -0.5411), vec3<f32>(0.0352, -0.0631, 0.5460), vec3<f32>(-0.4776, 0.2847, -0.0271)
    );
    var occlusion = 0.0;
    for (var i = 0; i < 16; i = i + 1) {
        let ray = radiusDepth * reflect(sampleSphere[i], random);
        let hemiRay = position + sign(dot(ray, normal)) * ray;
        let occlusionDepth = textureSample(depthTex, depthSamp, clamp(hemiRay.xy, vec2<f32>(0.001), vec2<f32>(0.999))).r;
        let difference = depth - occlusionDepth;
        occlusion += step(fallOff, difference) * (1.0 - smoothstep(fallOff, area, difference));
    }
    return clamp(1.0 - occlusion / 16.0, 0.0, 1.0);
}
`;function m(e){return e.replace(/[^A-Za-z0-9_]/g,"_")}function a(e,o){return typeof e=="number"?`${e}`:`${o}`}var u={className:"AmbientOcclusionBlock",stage:"fragment",emit(e,o,n,t,f){let c=e.inputs.get("source")?.source;if(!c)throw new Error(`NodeMaterial: AmbientOcclusionBlock "${e.name}" requires an ImageSourceBlock source`);let p=f.graph.blocks.get(c.blockId),r=m(p?.name||`ao${e.id}`);t.textures.find(l=>l.name===r)||t.textures.push({name:r,kind:"texture2d",texture:null}),t.fragment.helpers.set(d,i);let s=f.cast(f.resolve(e,"screenSize",n,t),"vec2f").expr;return{expr:`nme_computeAo(nodeTex_${r}, nodeSamp_${r}, _NME_FRAG_COORD_, ${s}, ${a(e.serialized.radius,1e-4)}, ${a(e.serialized.area,.0075)}, ${a(e.serialized.fallOff,1e-6)})`,type:"f32"}}};export{u as emitter};
