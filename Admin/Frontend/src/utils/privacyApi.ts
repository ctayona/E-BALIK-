import {API_URL,getAuthHeaders,adminMutationRequest} from "./api";
import type {SharedScan} from "../../../../Users/Frontend/src/app/utils/tags";

export type ScanRow=SharedScan;
export interface ReviewReport {
 kind:"found"|"missing";item_id:string;reference:string;item_name:string;category:string;
 description:string;location:string;image_url?:string;created_at:string;
 state:"pending"|"approved"|"rejected";version:number;custody_status?:string;reporter:string;
}
export async function privacyRead<T>(path:string,query:Record<string,string|number>={}):Promise<T>{
 const params=new URLSearchParams(Object.entries(query).map(([k,v])=>[k,String(v)]));
 const response=await fetch(`${API_URL}/api/admin/${path}?${params}`,{headers:getAuthHeaders(),cache:"no-store"});
 const data=await response.json();if(!response.ok)throw Error(data.error||"Unable to load this page.");return data;
}
export async function privacyWrite(path:string,body:unknown,title:string){
 const response=await adminMutationRequest(`${API_URL}/api/admin/${path}`,{method:"POST",headers:getAuthHeaders(),body:JSON.stringify(body)},title);
 const data=await response.json();if(!response.ok)throw Error(data.error||"Unable to save this change.");return data;
}
