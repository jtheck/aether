var a={className:"ScaleBlock",emit(t,s,r,o,e){let p=e.resolve(t,"input",r,o),c=e.resolve(t,"factor",r,o),n=e.cast(c,"f32").expr;return{expr:`(${p.expr} * ${n})`,type:p.type}}};export{a as emitter};
