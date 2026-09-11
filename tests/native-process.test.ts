import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeProcessForHost} from '../src/runtime/host/native-process';

test('native relaunch finds its session before a receipt without selecting another canvas or prefix match', () => {
 const processes = `
 10 /tmp/CanvasSwift.app/CanvasSwift --host-id target-other
 11 /tmp/Other.app/Other --host-id target
 12 /tmp/path with spaces/CanvasSwift.app/CanvasSwift --canvas-runtime http://127.0.0.1:1234 --host-id target
 13 /tmp/CanvasSwift.app/CanvasSwift --host-id another
 `;
 assert.equal(nativeProcessForHost(processes,'CanvasSwift','target'),12);
 assert.equal(nativeProcessForHost(processes,'CanvasSwift','missing'),undefined);
 assert.equal(nativeProcessForHost('not-a-pid /tmp/CanvasSwift.app/CanvasSwift --host-id target','CanvasSwift','target'),undefined);
});
