import { tracedFetch as fetch } from '@line-crm/shared/server';
import {GapError} from './gap-common.js';
const b64=(b:Uint8Array)=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const unbase64=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const te=new TextEncoder();
const concat=(...bytes:Uint8Array[])=>{const out=new Uint8Array(bytes.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of bytes){out.set(b,offset);offset+=b.length;}return out;};
async function hkdf(ikm:Uint8Array,salt:Uint8Array,info:Uint8Array,length:number){const key=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,length*8));}
export function validPushEndpoint(value:unknown):value is string {
 if(typeof value!=='string'||value.length>2048)return false;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(u.hostname);}catch{return false;}
}
export async function sendWebPush(input:{endpoint:string;p256dh:string;auth:string;payload:unknown;publicKey:string;privateKey:string;subject:string},fetchImpl:typeof fetch=fetch){
 if(!validPushEndpoint(input.endpoint))throw new GapError('invalid_push_endpoint');
 const receiver=unbase64(input.p256dh),auth=unbase64(input.auth),publicKey=unbase64(input.publicKey);
 if(receiver.length!==65||auth.length!==16||publicKey.length!==65)throw new GapError('invalid_push_keys');
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']) as CryptoKeyPair,remote=await crypto.subtle.importKey('raw',receiver,{name:'ECDH',namedCurve:'P-256'},false,[]),shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:remote} as unknown as SubtleCryptoDeriveKeyAlgorithm,pair.privateKey,256)),sender=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey) as ArrayBuffer);
 const ikm=await hkdf(shared,auth,concat(te.encode('WebPush: info\0'),receiver,sender),32),salt=crypto.getRandomValues(new Uint8Array(16));
 const key=await hkdf(ikm,salt,te.encode('Content-Encoding: aes128gcm\0'),16),nonce=await hkdf(ikm,salt,te.encode('Content-Encoding: nonce\0'),12),data=concat(te.encode(JSON.stringify(input.payload)),new Uint8Array([2]));
 if(data.length>3900)throw new GapError('push_payload_too_large');
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']),data));
 const header=concat(salt,new Uint8Array([0,0,16,0,65]),sender),jwtHead=b64(te.encode('{"typ":"JWT","alg":"ES256"}')),jwtBody=b64(te.encode(JSON.stringify({aud:new URL(input.endpoint).origin,exp:Math.floor(Date.now()/1000)+43200,sub:input.subject}))),signing=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:b64(publicKey.slice(1,33)),y:b64(publicKey.slice(33)),d:input.privateKey},{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signed=`${jwtHead}.${jwtBody}`,signature=b64(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signing,te.encode(signed))));
 return fetchImpl(input.endpoint,{method:'POST',headers:{Authorization:`vapid t=${signed}.${signature}, k=${input.publicKey}`,'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm',TTL:'60'},body:concat(header,cipher),redirect:'error',signal:AbortSignal.timeout(10000)});
}
