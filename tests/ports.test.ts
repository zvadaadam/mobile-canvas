import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reserveMetroPort } from '../src/runtime/host/ports';
test('simultaneous native launches reserve distinct Metro ports until their launchers release them', async()=>{
 const leases=await Promise.all([reserveMetroPort(24100,24120),reserveMetroPort(24100,24120),reserveMetroPort(24100,24120)]);
 try { assert.equal(new Set(leases.map(lease=>lease.port)).size,3); }
 finally { await Promise.all(leases.map(lease=>lease.release())); }
 const again=await reserveMetroPort(24100,24120);await again.release();
});
