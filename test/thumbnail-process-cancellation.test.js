const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function loadProcessHarness() {
  const mainPath = path.join(__dirname, '..', 'src', 'main.js');
  const source = fs.readFileSync(mainPath, 'utf8');

  const start = source.indexOf('const PROCESS_TIMEOUT_MS');
  const end = source.indexOf('function terminateChildProcesses()');
  assert.notEqual(start, -1, 'PROCESS_TIMEOUT_MS block was not found in src/main.js');
  assert.notEqual(end, -1, 'terminateChildProcesses() was not found in src/main.js');

  let block = source.slice(start, end);
  // Keep the timeout test fast without changing production code.
  block = block.replace('const PROCESS_TIMEOUT_MS = 30_000;', 'const PROCESS_TIMEOUT_MS = 25;');
  block += `
    globalThis.__i4 = {
      runProcess,
      cancelThumbnailProcess,
      clearThumbnailCancellation,
      thumbnailProcesses,
      cancelledThumbnailJobs,
      activeChildProcesses
    };
  `;

  const spawned = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      if (child.killed) return false;
      child.killed = true;
      queueMicrotask(() => child.emit('close', null));
      return true;
    };
    spawned.push(child);
    return child;
  };

  const context = {
    spawn,
    Buffer,
    Error,
    Promise,
    Set,
    Map,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    activeChildProcesses: new Set()
  };
  vm.createContext(context);
  vm.runInContext(block, context, { filename: 'src/main.js#i4-process-harness' });

  return { api: context.__i4, spawned };
}

test('normal process completion cleans active/job tracking', async () => {
  const { api, spawned } = loadProcessHarness();
  const promise = api.runProcess('fake', [], 1024, { jobId: 'normal-1' });
  assert.equal(spawned.length, 1);

  spawned[0].stdout.emit('data', Buffer.from('ok'));
  spawned[0].emit('close', 0);

  const result = await promise;
  assert.equal(result.code, 0);
  assert.equal(result.stdout.toString(), 'ok');
  assert.equal(api.thumbnailProcesses.size, 0);
  assert.equal(api.activeChildProcesses.size, 0);
});

test('cancelling a running child kills it and records cancellation', async () => {
  const { api, spawned } = loadProcessHarness();
  const promise = api.runProcess('fake', [], 1024, { jobId: 'cancel-1' });
  assert.equal(spawned.length, 1);

  assert.equal(api.cancelThumbnailProcess('cancel-1'), true);
  assert.equal(spawned[0].killed, true);
  assert.equal(api.cancelledThumbnailJobs.has('cancel-1'), true);

  await promise;
});

test('cancel between subprocesses prevents the next spawn', async () => {
  const { api, spawned } = loadProcessHarness();

  const first = api.runProcess('ffprobe', [], 1024, { jobId: 'gap-1' });
  assert.equal(spawned.length, 1);
  spawned[0].emit('close', 0);
  await first;

  // This is the race window: no child exists, but the logical thumbnail job is alive.
  assert.equal(api.thumbnailProcesses.has('gap-1'), false);
  assert.equal(api.cancelThumbnailProcess('gap-1'), true);
  assert.equal(api.cancelledThumbnailJobs.has('gap-1'), true);

  await assert.rejects(
    api.runProcess('ffmpeg', [], 1024, { jobId: 'gap-1' }),
    /cancelled/i
  );
  assert.equal(spawned.length, 1, 'a second subprocess must not be spawned');
});

test('clearing cancellation allows a later reused job id', async () => {
  const { api, spawned } = loadProcessHarness();

  api.cancelThumbnailProcess('reuse-1');
  await assert.rejects(
    api.runProcess('fake', [], 1024, { jobId: 'reuse-1' }),
    /cancelled/i
  );
  assert.equal(spawned.length, 0);

  api.clearThumbnailCancellation('reuse-1');
  const promise = api.runProcess('fake', [], 1024, { jobId: 'reuse-1' });
  assert.equal(spawned.length, 1);
  spawned[0].emit('close', 0);
  await promise;
});

test('timeout kills the child and cleans tracking', async () => {
  const { api, spawned } = loadProcessHarness();

  const promise = api.runProcess('fake', [], 1024, { jobId: 'timeout-1' });
  assert.equal(spawned.length, 1);

  await assert.rejects(promise, /timeout|タイムアウト/i);
  assert.equal(spawned[0].killed, true);
  assert.equal(api.thumbnailProcesses.size, 0);
  assert.equal(api.activeChildProcesses.size, 0);
});
