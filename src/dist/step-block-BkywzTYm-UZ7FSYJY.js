var n={className:"StepBlock",emit(p,c,r,o,e){let t=e.resolve(p,"value",r,o),s=e.resolve(p,"edge",r,o);return{expr:`step(${e.cast(s,t.type).expr}, ${t.expr})`,type:t.type}}};export{n as emitter};
