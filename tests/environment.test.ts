import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectEnvironment } from '../src/runtime/environment';

test('setup reports prerequisites without echoing signing identities and distinguishes manual build verification', async () => {
  const report = await inspectEnvironment({}, { platform: 'darwin', arch: 'arm64', node: '22.14.0', team: 'ABCDEFGHIJ', probe: async (command, args) => command === 'security' ? '1) HASH "Apple Development: Private Person (SECRET)"\n 1 valid identities found' : command === 'pod' ? '1.16.2' : args[0] === '-version' ? 'Xcode 26.6\nBuild version test' : '' });
  assert.equal(report.readyToBuild, true);
  assert.equal(report.checks.find(check => check.id === 'native-build')?.status, 'manual');
  assert.ok(!JSON.stringify(report).includes('Private Person'));
  assert.ok(!JSON.stringify(report).includes('SECRET'));
});

test('setup gives actionable failures on an unsupported machine with missing tools', async () => {
  const report = await inspectEnvironment({}, { platform: 'linux', arch: 'x64', node: '22.13.0', team: 'invalid', probe: async () => { throw Error('Mac tools must not execute on Linux'); } });
  assert.equal(report.readyToBuild, false);
  assert.equal(report.sourceOnlyAvailable, false);
  for (const id of ['mac', 'node', 'xcode', 'xcode-first-launch', 'cocoapods', 'signing-team']) {
    const check = report.checks.find(check => check.id === id)!;
    assert.equal(check.status, 'missing', id);
    assert.ok(check.action, id);
  }
});

test('Swift shader projects distinguish a missing Metal compiler from unsupported build integration', {skip:process.platform !== 'darwin'}, async t => {
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {writeXcodeProject}=await import('../src/runtime/adapters/swift/build');
  const app=await mkdtemp(join(tmpdir(),'canvas-metal-'));
  t.after(()=>rm(app,{recursive:true,force:true}));
  await writeFile(join(app,'App.swift'),'import SwiftUI\nstruct Screen: View { var body: some View { Text("Hello") } }');
  await writeFile(join(app,'Shader.metal'),'// Test source membership only');
  await writeXcodeProject(app,[join(app,'App.swift'),join(app,'Shader.metal')],[],'TEST','test.metal');
  const probes: string[]=[];
  const report=await inspectEnvironment({app},{platform:'darwin',arch:'arm64',node:'22.14.0',team:'ABCDEFGHIJ',probe:async(command,args)=>{
    probes.push(command+' '+args.join(' '));
    return command==='xcrun' ? null : args[0]==='-version' ? 'Xcode 26.6' : '';
  }});
  assert.equal(report.checks.find(check=>check.id==='metal-toolchain')?.status,'missing');
  assert.match(report.checks.find(check=>check.id==='metal-toolchain')!.action!,/downloadComponent MetalToolchain/);
  assert.equal(report.checks.find(check=>check.id==='swift-build-integration'),undefined);
  assert.ok(probes.includes('xcrun metal --version'));
  assert.ok(!probes.some(command=>command.includes('downloadComponent')),'diagnostics never install the component');
});
