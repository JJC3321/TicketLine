const R="http://127.0.0.1:8899";
const post=(m,p)=>fetch(R,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})}).then(r=>r.json());
const VOTE="3YNuk2tpHaGRW5mfgEcavKLLJG4QZTCJt7wfySa9VVsA";
const a=await post("getAccountInfo",[VOTE,{encoding:"base64"}]);
const acct=a.result.value;
const b=Buffer.from(acct.data[0],"base64");
const dv=new DataView(b.buffer,b.byteOffset,b.length);
const b58=(o)=>{const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let d=[],s="";for(let i=0;i<32;i++){let c=b[o+i],j2=0;for(;c||j2<d.length;j2++){c+=(d[j2]||0)<<8;d[j2]=c%58;c=(c/58)|0}}for(let k=0;k<32&&b[o+k]===0;k++)s+="1";return s+d.reverse().map(x=>A[x]).join("")};
console.log("lamports",acct.lamports,"len",b.length,"tag",dv.getUint32(0,true),"node",b58(4),"withdrawer",b58(36),"coll",b58(68),"blockcoll",b58(100),"inflCommBps",dv.getUint16(132,true),"blockCommBps",dv.getUint16(134,true),"pending",dv.getBigUint64(136,true).toString(),"blsTag",b[144]);
if(b[144]===1){const bls=b.slice(145,193);console.log("bls nonzero:",bls.some(x=>x!==0));}
const rent=await post("getMinimumBalanceForRentExemption",[b.length]);
console.log("rentExempt",rent.result);
console.log("epochInfo",(await post("getEpochInfo",[])).result);
