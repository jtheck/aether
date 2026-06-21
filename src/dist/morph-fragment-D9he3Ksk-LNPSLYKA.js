import{Sg as o}from"./chunk-LFLB3D3T.js";var n=1,m=`var morphedPos = position;
var morphedNorm = normal;
let mCol = i32(vertexIndex % morph.texWidth);
let mRowInBand = i32(vertexIndex / morph.texWidth);
for (var i = 0u; i < morph.count; i = i + 1u) {
  let w = morph.weights[i];
  let posBase = i32(i * 2u) * i32(morph.rowsPerBand);
  let normBase = i32(i * 2u + 1u) * i32(morph.rowsPerBand);
  morphedPos = morphedPos + w * textureLoad(morphTargets, vec2<i32>(mCol, posBase + mRowInBand), 0).xyz;
  morphedNorm = morphedNorm + w * textureLoad(morphTargets, vec2<i32>(mCol, normBase + mRowInBand), 0).xyz;
}`;function s(){return{_id:"morph",_vertexBuiltins:[{_name:"vertexIndex",_builtin:"vertex_index",_type:"u32"}],_vertexHelperFunctions:`struct morphUniforms {
weights: vec4<f32>,
count: u32,
texWidth: u32,
rowsPerBand: u32,
_p0: u32,
}`,_vertexBindings:[{_name:"morphTargets",_type:{_kind:"texture",_textureType:"texture_2d<f32>",_sampleType:"unfilterable-float"},_visibility:n},{_name:"morph",_type:{_kind:"uniform-buffer"},_visibility:n}],_vertexSlots:{VR:m}}}var p={id:"morph",phase:"vertex",frag(r){return r._meshFeatures&o?s():null},bind(r,i,t){let e=r._mesh;return!(r._meshFeatures&o)||!e?.morphTargets||(i.push({binding:t++,resource:e.morphTargets.texture.createView()}),e.morphTargets.weightsBuffer&&i.push({binding:t++,resource:{buffer:e.morphTargets.weightsBuffer}})),t}};export{s as createMorphFragment,p as pbrExt};
