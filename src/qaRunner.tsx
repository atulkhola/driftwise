// @ts-nocheck
export function runQA(){
  try{
    const p=new URLSearchParams(location.search);
    if(p.get("qa")!=="1") return;
    const b=document.createElement("div");
    b.style.cssText="position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:999999;padding:8px 12px;border-radius:12px;background:rgba(0,0,0,.85);color:#fff;font:12px/1.2 system-ui";
    b.textContent="QA mode ready"; document.body.appendChild(b);
  }catch{}
}
