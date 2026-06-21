var l={className:"PowBlock",emit(o,n,r,t,e){let p=e.resolve(o,"value",r,t),s=e.resolve(o,"power",r,t),c=e.cast(s,p.type).expr;return{expr:`pow(${p.expr}, ${c})`,type:p.type}}};export{l as emitter};
