import type {SwiftScan} from './scan';

/** A conservative source diagnostic, separate from building or inventing service implementations. */
export function swiftStartupRequirements(scans:SwiftScan[]) {
  const declarations=scans.flatMap(scan=>scan.declarations.map(d=>({...d,file:scan.path})));
  const services=new Set<string>();
  for(const main of declarations.filter(d=>d.main)) {
    for(const call of scans.flatMap(s=>s.calls).filter(c=>c.owner===main.symbol && c.name==='configure')) {
      const receiver=call.expression.match(/^([\w]+)(?:\.shared)?\.configure\s*\(/)?.[1];
      if (!receiver) continue;
      const type=main.fields.find(field=>field.name===receiver)?.type ?? receiver;
      if (declarations.some(d=>d.name===type && !d.isView)) services.add(type);
    }
  }
  const references=new Map<string,Set<string>>();
  const append=(name:string,values:string[])=>references.set(name,new Set([...(references.get(name) ?? []),...values]));
  for(const declaration of declarations) append(declaration.name,[...(declaration.references ?? []),...declaration.fields.map(f=>f.type)]);
  for(const scan of scans) {
    for(const property of scan.properties) {
      append(property.owner,property.references);
      // Environment key-path providers may be defined in another source file.
      if(property.owner==='EnvironmentValues') append(property.name,property.references);
    }
    for(const call of scan.calls) append(call.owner,call.identifiers);
  }
  return (symbols:string[])=>{
    const found=new Set<string>(),visited=new Set<string>();
    const visit=(name:string)=>{
      if(visited.has(name)) return;
      visited.add(name);
      if(services.has(name)) {found.add(name);return;}
      for(const next of references.get(name) ?? []) visit(next);
    };
    symbols.forEach(visit);
    return [...found].sort();
  };
}
