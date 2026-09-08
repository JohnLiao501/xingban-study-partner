// Local desktop acceptance only. Screen selection remains a manual UI action.
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { Stage3MockVisionServer } from '../dist-electron/electron/acceptance/mock-vision-server.js';
import { auditStage3AcceptanceDirectory, removeStage3AcceptanceDirectory } from '../dist-electron/electron/acceptance/stage3-evidence.js';

const require = createRequire(import.meta.url);
const { _electron } = require(process.argv[2]);
const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(os.tmpdir(), 'xingban-stage3-acceptance-'));
const mock = new Stage3MockVisionServer();
const output = (kind, data) => console.log(JSON.stringify({ kind, ...data }));
let application;
try {
  const env = { ...process.env, XINGBAN_STAGE3_ACCEPTANCE: '1', XINGBAN_ACCEPTANCE_USER_DATA: directory, XINGBAN_ACCEPTANCE_MOCK_BASE_URL: await mock.start() };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.XINGBAN_STAGE3_B2_DISABLE_CONTENT_PROTECTION;
  application = await _electron.launch({ executablePath: require('electron'), args: [root], env, timeout: 30000 });
  let buffer = '';
  application.process().stdout.on('data', chunk => {
    buffer += chunk.toString();
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
      if (line.startsWith('[Acceptance:')) console.log(line);
    }
  });
  let page;
  for (let attempt = 0; attempt < 100; attempt++) {
    page = application.windows().find(candidate => candidate.url().startsWith('file:') && !new URL(candidate.url()).searchParams.has('view'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!page) throw new Error('MAIN_WINDOW_MISSING');
  await page.waitForLoadState('domcontentloaded');
  const status = async () => output('status', await page.evaluate(async () => {
    const snapshot = await window.studyPartner.getActiveSession();
    return { capture: await window.studyPartner.getCaptureStatus(), phase: snapshot?.phase, paused: snapshot?.paused, seconds: snapshot?.focusedSeconds, deviations: snapshot?.deviationCount };
  }));
  output('ready', { pid: application.process().pid, isolated: true, commands: ['status', 'fullscreen', 'restore', 'destroy-capture', 'quit'] });
  const input = createInterface({ input: process.stdin });
  for await (const command of input) {
    if (command === 'quit') break;
    if (command === 'status') await status();
    else if (command === 'fullscreen' || command === 'restore') {
      output(command, await application.evaluate(({ BrowserWindow, screen }, fullscreen) => {
        const main = BrowserWindow.getAllWindows().find(w => !new URL(w.webContents.getURL()).searchParams.has('view'));
        main.setFullScreen(fullscreen);
        return { protected: main.isContentProtected(), displays: screen.getAllDisplays().map(d => ({ scale: d.scaleFactor, width: d.size.width, height: d.size.height })) };
      }, command === 'fullscreen'));
      await status();
    } else if (command === 'destroy-capture') {
      output('destroy-capture', await application.evaluate(({ BrowserWindow }) => {
        const capture = BrowserWindow.getAllWindows().find(w => new URL(w.webContents.getURL()).searchParams.get('view') === 'capture');
        if (!capture) return { destroyed: false };
        capture.destroy();
        return { destroyed: capture.isDestroyed() };
      }));
      await status();
    } else output('rejected', {});
  }
  input.close();
} catch {
  output('runner-error', { pass: false });
  process.exitCode = 1;
} finally {
  let exited = !application;
  if (application) {
    const child = application.process();
    await application.close().catch(() => {});
    exited = child.exitCode !== null || child.signalCode !== null;
  }
  await mock.close();
  output('exit', { exited, mockRequests: mock.getSummary().requestCount });
  if (exited) {
    output('privacy', await auditStage3AcceptanceDirectory(directory));
    output('cleanup', { removed: await removeStage3AcceptanceDirectory(directory) });
  }
}
