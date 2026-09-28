import{V as s}from"./three.webgpu-GwCC1aPf.js";const k=5,ue=2.5,me=4,ye=.1,Le=40,te=.002,oe=Math.PI/2-.01,he=750,ne=20,ie=90;function h(t){return Number(t).toFixed(2)}function S(t){return`[${t.map(h).join(", ")}]`}function L(t,c,g){return Math.max(c,Math.min(g,t))}function ve({viewer:t,story:c,walkthrough:g}){const F=document.createElement("style");F.textContent=`
    .pose-capture {
      background: rgb(15 22 20 / 76%);
      border: 1px solid rgb(255 255 255 / 18%);
      border-radius: 9px;
      bottom: 16px;
      color: rgb(255 255 255 / 82%);
      font: 10px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      left: 16px;
      letter-spacing: .01em;
      max-width: calc(100vw - 32px);
      padding: 8px 10px;
      pointer-events: none;
      position: fixed;
      white-space: nowrap;
      z-index: 80;
    }
    .pose-capture strong { color: var(--acid, #d8ff58); font-weight: 600; }
    .pose-capture.is-copied { border-color: var(--acid, #d8ff58); color: white; }
    .pose-capture.is-fly {
      border-color: rgb(216 255 88 / 70%);
      box-shadow: 0 0 0 1px rgb(216 255 88 / 10%), 0 8px 28px rgb(0 0 0 / 22%);
    }
    .pose-capture .pose-fly-indicator {
      background: var(--acid, #d8ff58);
      border-radius: 999px;
      color: #152018;
      display: inline-block;
      letter-spacing: .08em;
      padding: 0 5px;
    }
    @media (max-width: 700px) {
      .pose-capture { bottom: 10px; font-size: 8px; left: 10px; max-width: calc(100vw - 20px); }
    }
  `;const a=document.createElement("aside");a.className="pose-capture",a.setAttribute("aria-live","polite");const R=document.createElement("div"),V=document.createElement("div");a.append(R,V),document.head.append(F),document.body.append(a);const d=t.renderer.domElement,x=new s,r=new s,M=new s,l=new s,Y=new s(0,1,0),p=new s,A=new s,I=new s,O=new s,N=new s,W=new s,n=new Set;let i="idle",E=ue,m=0,v=0,y=t.camera.fov,U=0,K=!1,C=!1,w="",z="",T="C copy",_=0;function $(){const e=Math.cos(v);return r.set(-Math.sin(m)*e,Math.sin(v),-Math.cos(m)*e),r}function B(){const{camera:e}=t;return i!=="idle"?(e.getWorldDirection(r),x.copy(e.position).addScaledVector(r,k)):g.active?(e.getWorldDirection(r),x.copy(e.position).add(r)):c.copyCameraTarget(x),{eye:e.position.toArray(),tgt:x.toArray(),fov:e.fov}}function q(){const e=B();R.textContent=`eye: ${S(e.eye)} · tgt: ${S(e.tgt)} · fov: ${h(e.fov)}`,w=Q(e)}function Q(e=B()){const o=c.moment,u=o.beat?`, "beat": "${o.beat}"`:`, "transition": "${o.transition}", "t": ${h(o.t)}`;return`{ "eye": ${S(e.eye)}, "tgt": ${S(e.tgt)}, "fov": ${h(e.fov)}${u} }`}function f(){const e=c.transition,o=i==="fly"?`<strong class="pose-fly-indicator">FLY</strong> · ${h(E)} m/s · click view · WASD · Q/E · [/] FOV · F/Esc exit`:i==="return"?"<strong>RETURN</strong>":"F fly",u=`<strong>${e.from} → ${e.to}</strong> · t=${h(e.progress)} · ${o} · ${T}`;u!==z&&(z=u,V.innerHTML=u)}function re(e){if(l.set(0,0,0),$(),M.set(Math.cos(m),0,-Math.sin(m)),n.has("KeyW")&&l.add(r),n.has("KeyS")&&l.sub(r),n.has("KeyD")&&l.add(M),n.has("KeyA")&&l.sub(M),(n.has("KeyE")||n.has("Space"))&&l.add(Y),(n.has("KeyQ")||n.has("ControlLeft")||n.has("ControlRight"))&&l.sub(Y),l.lengthSq()===0)return!1;l.normalize();const o=n.has("ShiftLeft")||n.has("ShiftRight");return p.addScaledVector(l,E*(o?me:1)*Math.min(e,.05)),!0}function ce({camera:e,target:o,time:u,delta:fe}){if(i==="fly"){const pe=re(fe);e.position.copy(p),e.fov=y,e.clearViewOffset(),o.copy(p).addScaledVector($(),k),e.lookAt(o),pe&&t.invalidate();return}if(i!=="return")return;N.copy(e.position),W.copy(o);const b=L((u-U)/he,0,1),P=b*b*(3-2*b);e.position.lerpVectors(I,N,P),o.lerpVectors(O,W,P),e.fov=y+(e.fov-y)*P,e.clearViewOffset(),e.lookAt(o),t.invalidate(),b>=1&&(i="idle",c.setCameraOverride(null),c.setLookLocked("pose-fly",!1),a.classList.remove("is-fly"),f())}function X(){if(i!=="fly"||document.pointerLockElement===d)return;d.requestPointerLock?.()?.catch?.(()=>{})}function se(){const{camera:e}=t;e.getWorldDirection(r),p.copy(e.position),m=Math.atan2(-r.x,-r.z),v=Math.asin(L(r.y,-1,1)),y=L(e.fov,ne,ie),A.copy(p).addScaledVector(r,k),g.active&&g.exit(),n.clear(),i="fly",K=!1,c.setLookLocked("pose-fly",!0),c.setCameraOverride(ce),a.classList.add("is-fly"),f(),t.invalidate(),X()}function D(){i==="fly"&&(n.clear(),I.copy(p),O.copy(A.copy(p).addScaledVector($(),k)),U=performance.now(),i="return",document.pointerLockElement===d&&(C=!0,document.exitPointerLock()),a.classList.remove("is-fly"),f(),t.invalidate())}async function ae(){w=Q(),console.info(`[camera pose] ${w}`);let e="copied";try{await navigator.clipboard.writeText(w)}catch{e="logged"}window.clearTimeout(_),T=e,a.classList.add("is-copied"),f(),_=window.setTimeout(()=>{T="C copy",a.classList.remove("is-copied"),f()},900)}function H(e){if(e.code==="KeyC"&&!e.metaKey&&!e.ctrlKey&&!e.altKey){ae();return}if(e.code==="KeyF"&&!e.repeat&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault(),i==="fly"?D():se();return}if(i==="fly"){if(e.code==="Escape"){e.preventDefault(),D();return}if(e.code==="BracketLeft"||e.code==="BracketRight"){e.preventDefault();const o=e.shiftKey?.25:1;y=L(y+(e.code==="BracketRight"?o:-o),ne,ie),t.invalidate();return}["KeyW","KeyA","KeyS","KeyD","KeyQ","KeyE","Space","ControlLeft","ControlRight","ShiftLeft","ShiftRight"].includes(e.code)&&(e.preventDefault(),n.add(e.code),t.invalidate())}}function j(e){n.delete(e.code)}function G(e){i!=="fly"||document.pointerLockElement!==d||(m-=e.movementX*te,v=L(v-e.movementY*te,-oe,oe),t.invalidate())}function J(e){i==="fly"&&(e.preventDefault(),E=L(E*Math.exp(-e.deltaY*.0015),ye,Le),f())}function Z(){if(document.pointerLockElement===d){K=!0;return}if(C){C=!1;return}i==="fly"&&K&&D()}function ee(){X()}const le=t.subscribeRender(q),de=c.subscribeFrame(f);return window.addEventListener("keydown",H),window.addEventListener("keyup",j),window.addEventListener("wheel",J,{passive:!1}),document.addEventListener("mousemove",G),document.addEventListener("pointerlockchange",Z),d.addEventListener("click",ee),q(),f(),t.invalidate(),()=>{le(),de(),window.removeEventListener("keydown",H),window.removeEventListener("keyup",j),window.removeEventListener("wheel",J),document.removeEventListener("mousemove",G),document.removeEventListener("pointerlockchange",Z),d.removeEventListener("click",ee),window.clearTimeout(_),n.clear(),c.setCameraOverride(null),c.setLookLocked("pose-fly",!1),document.pointerLockElement===d&&document.exitPointerLock(),a.remove(),F.remove()}}export{ve as mountPoseCapture};
