const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {promisify}=require('node:util');
const {createHelperRegistry,execFile}=require('../helper-processes');
test('shutdown terminates tracked children, waits for close, denies new jobs and is idempotent',async()=>{
  const registry=createHelperRegistry();const child=new EventEmitter();child.pid=123;
  let killed=0;child.kill=()=>{killed++;setImmediate(()=>child.emit('close',0));};
  registry.track(child);const first=registry.stop();assert.equal(registry.stop(),first);
  assert.throws(()=>registry.assertOpen(),/shutting down/);
  assert.deepEqual(await first,[]);assert.equal(killed,1);
});
test('bounded shutdown reports exact helpers that failed to close',async()=>{
  const registry=createHelperRegistry({timeoutMs:20});const child=new EventEmitter();child.pid=234;child.kill=()=>false;
  registry.track(child);assert.deepEqual(await registry.stop(),[234]);child.emit('close',0);
});
test('promisified helper exec keeps stdout/stderr semantics',async()=>{
  const result=await promisify(execFile)(process.execPath,['-e','process.stdout.write("out");process.stderr.write("err")']);
  assert.equal(result.stdout,'out');assert.equal(result.stderr,'err');
});
