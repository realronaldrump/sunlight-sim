import { directFlightInput } from '../../../shared/droneTouch';

interface TouchActions {
  map(): void; options(): void; chat(): void; camera(): void; hold(): void; allowed(): boolean;
}

/** Look anywhere on the scene; hold Fly or Back with the other thumb. No sticks or destinations. */
export class TouchControls {
  readonly root=document.createElement('section');
  private enabled=false;
  private lookPointer: {id:number;x:number;y:number} | null=null;
  private held=new Map<number,{element:HTMLElement;direction:number}>();
  private look={x:0,y:0};
  private connection:HTMLElement;
  private help:HTMLElement;
  private status:HTMLElement;
  private focused=true;

  constructor(private canvas:HTMLElement,private actions:TouchActions) {
    this.root.id='touch-flight';this.root.hidden=true;
    this.root.setAttribute('aria-label','Touch drone controls');
    this.root.innerHTML=`<nav class="flight-toolbar" aria-label="Flight tools">
      <button id="touch-map" type="button">Map</button><button id="touch-view" type="button">View</button>
      <button id="touch-chat" type="button">Chat</button><button id="touch-options" type="button">Pause</button>
      <button id="touch-help" type="button" aria-label="Flight help" aria-expanded="false">?</button></nav>
      <div class="flight-connection" role="status">Solo flight</div>
      <div class="flight-help" hidden><strong>Look. Fly. Explore.</strong>
        <p>Drag anywhere in the scenery to look.<br>Hold <b>Fly</b> to move where you are looking.<br>Release to slow into a hover.</p>
        <p>Look up to climb or down to descend.<br>Hold <b>Back</b> for slower reverse corrections.<br>You can look around while holding either button.</p>
        <p>Pause to recall or travel to a run or friend.</p><button type="button">Got it</button></div>
      <div class="flight-aim" aria-hidden="true"></div>
      <div class="flight-bottom"><div id="touch-flight-status" role="status">Hovering</div>
        <div class="flight-actions"><button id="touch-back" class="flight-move" type="button" aria-label="Hold to fly backward" aria-pressed="false">Back</button>
        <button id="touch-fly" class="flight-move" type="button" aria-label="Hold to fly forward" aria-pressed="false">Fly</button></div>
        <div class="flight-tip">Drag to look · Hold to fly · Release to hover</div></div>`;
    document.body.append(this.root);
    this.connection=this.root.querySelector('.flight-connection')!;
    this.help=this.root.querySelector('.flight-help')!;
    this.status=this.root.querySelector('#touch-flight-status')!;
    const bind=(id:string,action:()=>void)=>{
      this.root.querySelector<HTMLButtonElement>(id)!.onclick=()=>{this.reset();actions.hold();action();};
    };
    bind('#touch-map',actions.map);bind('#touch-view',actions.camera);bind('#touch-chat',actions.chat);bind('#touch-options',actions.options);
    bind('#touch-help',()=>{this.help.hidden=!this.help.hidden;this.root.querySelector('#touch-help')!.setAttribute('aria-expanded',String(!this.help.hidden));});
    this.help.querySelector('button')!.onclick=()=>{this.help.hidden=true;this.root.querySelector('#touch-help')!.setAttribute('aria-expanded','false');};

    for(const [id,direction] of [['#touch-fly',1],['#touch-back',-1]] as const) {
      const button=this.root.querySelector<HTMLButtonElement>(id)!;
      const keyId=-100-direction;
      button.addEventListener('pointerdown',e=>{
        if(!this.canFly || e.button!==0)return;
        e.preventDefault();this.held.set(e.pointerId,{element:button,direction});this.paintHeld();
        try{button.setPointerCapture(e.pointerId);}catch{/* Synthetic test pointer. */}
      });
      button.addEventListener('lostpointercapture',e=>{if(this.held.has(e.pointerId)){this.releaseFlight(e.pointerId);actions.hold();}});
      button.addEventListener('keydown',e=>{
        if(!['Space','Enter'].includes(e.code))return;
        e.preventDefault();e.stopPropagation();
        if(this.canFly){this.held.set(keyId,{element:button,direction});this.paintHeld();}
      });
      button.addEventListener('keyup',e=>{if(['Space','Enter'].includes(e.code)){e.preventDefault();e.stopPropagation();this.releaseFlight(keyId);}});
      button.addEventListener('blur',()=>this.releaseFlight(keyId));
      button.addEventListener('contextmenu',e=>e.preventDefault());
    }
    canvas.addEventListener('pointerdown',e=>{
      if(!this.canFly || e.button!==0 || this.lookPointer)return;
      e.preventDefault();this.lookPointer={id:e.pointerId,x:e.clientX,y:e.clientY};
      try{canvas.setPointerCapture(e.pointerId);}catch{/* Synthetic test pointer. */}
    });
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    window.addEventListener('pointermove',e=>{
      const p=this.lookPointer;if(!p || p.id!==e.pointerId || !this.canFly)return;
      e.preventDefault();this.look.x+=e.clientX-p.x;this.look.y+=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
    },{passive:false});
    window.addEventListener('pointerup',e=>{this.releaseFlight(e.pointerId);if(this.lookPointer?.id===e.pointerId)this.releaseLook();});
    window.addEventListener('pointercancel',e=>{
      if(this.held.has(e.pointerId) || this.lookPointer?.id===e.pointerId){this.reset();actions.hold();}
    });
    canvas.addEventListener('lostpointercapture',e=>{if(this.lookPointer?.id===e.pointerId){this.releaseLook();this.look={x:0,y:0};}});
    window.addEventListener('blur',()=>{this.focused=false;this.reset();actions.hold();});
    window.addEventListener('focus',()=>{this.focused=true;});
    window.addEventListener('pagehide',()=>{this.reset();actions.hold();});
    document.addEventListener('visibilitychange',()=>{this.reset();actions.hold();});
    window.addEventListener('resize',()=>{this.reset();actions.hold();});
    window.visualViewport?.addEventListener('resize',()=>{this.reset();actions.hold();});
  }

  private paintHeld(){
    for(const id of ['#touch-fly','#touch-back']){
      const button=this.root.querySelector<HTMLButtonElement>(id)!;
      const active=[...this.held.values()].some(p=>p.element===button);
      button.setAttribute('aria-pressed',String(active));button.classList.toggle('engaged',active);
    }
  }
  private releaseFlight(id:number){
    const p=this.held.get(id);if(!p)return;this.held.delete(id);
    if(id>=0 && p.element.hasPointerCapture(id))p.element.releasePointerCapture(id);
    this.paintHeld();
  }
  private releaseLook(){const p=this.lookPointer;this.lookPointer=null;if(p && this.canvas.hasPointerCapture(p.id))this.canvas.releasePointerCapture(p.id);}
  reset(){this.releaseLook();for(const id of [...this.held.keys()])this.releaseFlight(id);this.look={x:0,y:0};}
  get canFly(){return this.focused && !document.hidden && this.help.hidden && this.actions.allowed();}
  get direction(){const directions=new Set([...this.held.values()].map(p=>p.direction));return this.canFly && directions.size===1 ? [...directions][0] : 0;}
  input(pitch:number){return directFlightInput(this.direction,pitch);}
  update(visible:boolean,enabled:boolean,connection:string,canChat:boolean){
    this.root.hidden=!visible;
    const next=enabled && this.focused && !document.hidden;
    if(this.enabled && !next){this.reset();this.actions.hold();}this.enabled=next;
    if(this.connection.textContent!==connection)this.connection.textContent=connection;
    this.root.querySelector<HTMLButtonElement>('#touch-chat')!.disabled=!canChat;
  }
  showStatus(speed:number,warning:string){
    const warnings:Record<string,string>={boundary:'Mountain boundary',ceiling:'Altitude limit',ground:'Ground clearance',obstacle:'Obstacle ahead',loading:'Waiting for terrain'};
    const text=warnings[warning] || (this.direction>0 ? 'Flying' : this.direction<0 ? 'Reversing' : speed>.15 ? 'Slowing to hover' : 'Hovering');
    if(this.status.textContent!==text)this.status.textContent=text;
  }
  consumeLook(dt:number){
    const k=1-Math.exp(-Math.min(.1,dt)/.045),delta={x:this.look.x*k,y:this.look.y*k};
    this.look.x-=delta.x;this.look.y-=delta.y;return delta;
  }
}
