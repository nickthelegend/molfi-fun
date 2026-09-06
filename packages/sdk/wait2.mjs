import { hash } from "starknet";
const RPC="https://starknet-sepolia-rpc.publicnode.com";
const UD="0x07881b0cabd145d7135b8964c4b613697ef2fb2260d97657ef4c4f6245c17ce9";
const rpc=async(m,p)=>(await (await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})})).json());
const j=await rpc("starknet_call",[{contract_address:UD,entry_point_selector:hash.getSelectorFromName("get_round"),calldata:["0x2"]},"latest"]);
const cutoff=Number(BigInt(j.result[1]));
const left=cutoff-Math.floor(Date.now()/1000);
console.log("cutoff in", left, "s");
process.exit(left<=0?0:1);
