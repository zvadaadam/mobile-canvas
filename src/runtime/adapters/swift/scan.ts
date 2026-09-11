import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, mkdir, access, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { repository } from '../../paths';
import { cacheDirectory } from '../../installation';
const run = promisify(execFile);
export interface SwiftDeclaration { name: string; symbol: string; isView: boolean; referenceType?:boolean; main: boolean; references?: string[]; line: number; offset: number; requirements: string[]; nativeViewType: string; parameters: {name:string;type:string;hasDefault:boolean}[]; bodyRoot: string; members: string[]; environment: {type:string;kind:string}[]; fields: {name:string;type:string;accessible:boolean;mutable?:boolean;nonmutating?:boolean;environmentKey?:string}[]; inherits:string[]; accessible:boolean; projectable: boolean; generic: boolean }
export interface SwiftCall { owner: string; name: string; function: string; stateBranch: boolean; stateSelector?: string; stateCase?:string; inDestination: boolean; callbacks: string[]; line: number; expression: string; scopeBindings: {name:string;expression:string;identifiers:string[];offset:number;kind:'collection'|'optional'}[]; locals: string[]; identifiers: string[]; constructor: boolean; projection: string }
export interface SwiftBoundary { owner: string; kind: string; destinations: string[]; route: string; value: string; binding: string; line: number; offset: number }
export interface SwiftScan {
  path: string; main: boolean; compiledSource: string; motionAdapter?:boolean; imageAdapter?:boolean; boundsAdapter?:boolean;
  views: {name: string; offset: number}[];
  previews: {name: string; titled: boolean; factory: string; index: number; offset: number; references: string[]; providers?: {type:string;kind:string;expression:string;identifiers:string[]}[]; issue?: string}[];
  extensions: {type:string; fields:{name:string;type:string;accessible:boolean}[]}[];
  properties: {owner: string; name: string; references: string[]}[];
  declarations: SwiftDeclaration[]; calls: SwiftCall[]; boundaries: SwiftBoundary[];
}
let preparing: Promise<string> | undefined;
async function scanner() {
  if (preparing) return preparing;
  preparing = (async () => {
    const source = join(repository, 'src/runtime/adapters/swift/Scan.swift');
    const swift = (await run('xcrun', ['--find', 'swiftc'])).stdout.trim();
    const libraries = join(dirname(swift), '../lib/swift/host');
    const version = (await run(swift, ['--version'])).stdout;
    const sdk = (await run('xcrun', ['--sdk', 'macosx', '--show-sdk-path'])).stdout.trim();
    const key = createHash('sha256').update(await readFile(source)).update(version).digest('hex').slice(0, 20);
    const output = join(cacheDirectory, `swift-scan-${key}`);
    await mkdir(cacheDirectory, {recursive: true});
    if (!await access(output).then(() => true, () => false)) {
      const temporary = `${output}.${process.pid}`;
      await run(swift, [source, '-sdk', sdk, '-I', libraries, '-L', libraries, '-Xlinker', '-rpath', '-Xlinker', libraries, '-o', temporary], {timeout: 120_000});
      await rename(temporary, output);
    }
    return output;
  })();
  return preparing;
}
export async function scanSwift(files: {path: string; code: string; projections?: string; previewModifiers?: string; scenes?:string}[]): Promise<SwiftScan[]> {
  const executable = await scanner();
  return new Promise((resolve, reject) => {
    const child = execFile(executable, [], {maxBuffer: 32 * 1024 * 1024, timeout: 30_000}, (error, stdout) => {
      if (error) reject(error); else { try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); } }
    });
    child.stdin!.end(JSON.stringify(files));
  });
}
