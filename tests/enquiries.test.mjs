import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function makeEnv(recent=0) {
  const leads=[], outgoing=[];
  const db={prepare(sql) {
    let args=[];
    return {
      bind(...values){args=values;return this},
      async first(){if(sql.includes("COUNT(*)"))return {total:recent};throw new Error("Unexpected D1 read")},
      async run(){if(sql.includes("INSERT INTO Leads")){leads.push(args);return {meta:{changes:1}}}throw new Error("Unexpected D1 write")}
    };
  }};
  return {env:{DB:db,RESEND_API_KEY:"mock-key",ASSETS:{fetch:async()=>new Response("ok")}},leads,outgoing};
}
function request(email="visitor@example.com",payload={}){
 return new Request("https://goaxis.in/api/enquiry",{method:"POST",headers:{"Origin":"https://goaxis.in","Content-Type":"application/json"},body:JSON.stringify({name:"Visitor Name",email,service:"Complete Website Package",message:"I need a full website.",consent:true,...payload})});
}
test("Send delivers owner mail to contact alias, then customer confirmation from contact alias",async()=>{
 const old=globalThis.fetch;const {env,leads,outgoing}=makeEnv();
 globalThis.fetch=async(url,options)=>{
   assert.equal(url,"https://api.resend.com/emails");
   const mail=JSON.parse(options.body);
   outgoing.push(mail);
   assert.match(options.headers["Idempotency-Key"],/^goaxis-contact-/);
   return new Response(JSON.stringify({id:"mock-sent"}),{status:200});
 };
 try{
   const response=await worker.fetch(request(),env);
   assert.equal(response.status,200);
   const result=await response.json();
   assert.equal(result.ok,true);
   assert.equal(result.email_status,"sent");
   assert.equal(result.owner_notified,true);
   assert.equal(result.customer_confirmed,true);
   assert.match(result.reference,/^ENQ-/);
   assert.equal(leads.length,1);
   assert.equal(outgoing.length,2);
   assert.deepEqual(outgoing.map(x=>x.to[0]),["contact@goaxis.in","visitor@example.com"]);
   assert.ok(outgoing.every(x=>x.from==="GOAXIS <contact@goaxis.in>"));
   assert.match(outgoing[1].text,/Reference: ENQ-/);
 }finally{globalThis.fetch=old}
});
test("does not claim emails were sent when provider fails, but keeps stored enquiry",async()=>{
 const old=globalThis.fetch;const {env,leads}=makeEnv();let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response("provider unavailable",{status:503})};
 try{
   const response=await worker.fetch(request("failure@example.com"),env);
   const result=await response.json();
   assert.equal(response.status,200);
   assert.equal(result.email_status,"pending");
   assert.equal(result.customer_confirmed,false);
   assert.equal(result.owner_notified,false);
   assert.equal(leads.length,1);
   assert.equal(calls,1);
 }finally{globalThis.fetch=old}
});
test("limits repetitive enquiries and never emails at the hourly limit",async()=>{
 const old=globalThis.fetch;const {env,leads}=makeEnv(3);
 globalThis.fetch=async()=>{throw Error("No email expected")};
 try{
   const response=await worker.fetch(request(),env);
   assert.equal(response.status,429);
   assert.equal(leads.length,0);
 }finally{globalThis.fetch=old}
});
test("cross-origin POST is rejected before accessing the database",async()=>{
 const {env}=makeEnv();
 const req=new Request("https://goaxis.in/api/enquiry",{method:"POST",headers:{"Origin":"https://third-party.example","Content-Type":"application/json"},body:JSON.stringify({})});
 assert.equal((await worker.fetch(req,env)).status,403);
});
