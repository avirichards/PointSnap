// A string keeps the browser-side program independent of the worker's TS/JS
// compiler helpers. It runs only inside this service's fresh anonymous page.
export const SMILES_QUOTE_SCRIPT = String.raw`async ({flights,pax}) => {
  const api='https://api-air-flightsearch-blue.smiles.com.br';
  const taxApi='https://api-airlines-boarding-tax-blue.smiles.com.br';
  async function get(host,path,params){
    const u=new URL(path,host);u.search=new URLSearchParams(params).toString();
    const r=await fetch(u,{headers:{Accept:'application/json',Channel:'WEB'},credentials:host===taxApi?'include':'omit',signal:AbortSignal.timeout(15000)});
    if(!r.ok){
      const body=await r.json().catch(()=>({}));
      const detail=['code','errorCode','message','errorMessage'].filter(k=>typeof body[k]==='string').map(k=>k+': '+body[k].slice(0,160)).join('; ');
      const error=new Error(path+' returned HTTP '+r.status+(detail?' ('+detail+')':''));
      error.status=r.status;error.code=String(body.code??body.errorCode??'');throw error;
    }
    return r.json();
  }
  const extensions=Array(flights.length);let index=0;
  async function worker(){while(index<flights.length){
    const i=index++,f=flights[i],base=f.fareList.find(v=>v.type==='SMILES');
    if(!base?.uid||!f.uid||f.uid.length>500)throw new Error('Missing current-search fare identifier');
    const money=f.fareList.some(v=>v.type==='SMILES_MONEY')?await get(api,'/v1/airlines/pricesm',{flightuid:f.uid,fareType:'SMILES_MONEY'}):{fareList:[]};
    if(!Array.isArray(money.fareList)||money.fareList.length>100)throw new Error('Incomplete payment choices');
    const upsells=[];
    if(f.sourceGDS==='G3')for(const fare of [base,...money.fareList]){
      const original=f.fareList.find(v=>v.type===fare.type);
      if(!original?.uid)throw new Error('Missing payment-choice identifier');
      if(!original.uidupsell){upsells.push({fareList:[]});continue;}
      upsells.push(await get(api,'/v1/airlines/priceupsell',{flightuid:f.uid,fareuid:original.uid,...(fare.offer?{offer:String(fare.offer)}:{})}));
    }
    let tax;
    try {tax=await get(taxApi,'/v1/airlines/flight/boardingtax',{type:'SEGMENT_1',uid:f.uid,fareuid:base.uid,adults:String(pax),children:'0',infants:'0'});}
    catch(error){
      // Smiles explicitly says this offer has no seats on the live tax recheck.
      // Record the withdrawal; do not generalize other failures into sold-out.
      if(error.status===452&&error.code==='113'){
        extensions[i]={flightIndex:i,money,upsells,unavailable:{code:'113',reason:'seats-unavailable'}};continue;
      }
      throw new Error('Itinerary '+(i+1)+'/'+flights.length+': '+error.message);
    }
    extensions[i]={flightIndex:i,money,upsells,tax};
  }}
  // Keep public quote traffic sequential; do not retry airline failures.
  await worker();
  return extensions;
}`;
