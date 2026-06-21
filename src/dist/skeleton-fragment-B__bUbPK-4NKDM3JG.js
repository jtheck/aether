import{Qg as a,Rg as i}from"./chunk-LFLB3D3T.js";var o=1,m=`
fn readMatrixFromRawSampler(smp: texture_2d<f32>, index: f32) -> mat4x4<f32> {
let offset = i32(index) * 4;
let m0 = textureLoad(smp, vec2<i32>(offset + 0, 0), 0);
let m1 = textureLoad(smp, vec2<i32>(offset + 1, 0), 0);
let m2 = textureLoad(smp, vec2<i32>(offset + 2, 0), 0);
let m3 = textureLoad(smp, vec2<i32>(offset + 3, 0), 0);
return mat4x4f(m0, m1, m2, m3);
}
`;function l(e){let t=`var influence: mat4x4<f32> = readMatrixFromRawSampler(boneSampler, f32(joints[0])) * weights[0];
influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints[1])) * weights[1];
influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints[2])) * weights[2];
influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints[3])) * weights[3];`;return e&&(t+=`
influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints1[0])) * weights1[0];
influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints1[1])) * weights1[1];
influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints1[2])) * weights1[2];
influence = influence + readMatrixFromRawSampler(boneSampler, f32(joints1[3])) * weights1[3];`),t+=`
finalWorld = mesh.world * influence;`,t}function s(e){return{_id:"skeleton",_vertexAttributes:[{_name:"joints",_type:"vec4<u32>",_gpuFormat:"uint32x4",_arrayStride:16},{_name:"weights",_type:"vec4<f32>",_gpuFormat:"float32x4",_arrayStride:16},...e?[{_name:"joints1",_type:"vec4<u32>",_gpuFormat:"uint32x4",_arrayStride:16},{_name:"weights1",_type:"vec4<f32>",_gpuFormat:"float32x4",_arrayStride:16}]:[]],_vertexBindings:[{_name:"boneSampler",_type:{_kind:"texture",_textureType:"texture_2d<f32>",_sampleType:"unfilterable-float"},_visibility:o}],_vertexHelperFunctions:m,_vertexSlots:{VW:l(e)}}}var u={id:"skeleton",phase:"vertex",frag(e){return e._meshFeatures&a?s((e._meshFeatures&i)!==0):null},bind(e,t,r){let n=e._mesh;return!(e._meshFeatures&a)||!n?.skeleton||t.push({binding:r++,resource:n.skeleton.boneTexture.createView()}),r}};export{s as createSkeletonFragment,u as pbrExt};
