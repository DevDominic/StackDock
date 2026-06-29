import { BrowserWindow, shell } from 'electron';
import crypto from 'crypto';
import fs from 'fs/promises';
import http from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import { logError } from './log';
import { getDataDir } from './storage';

let server: http.Server | null = null;
let port = 0;
let token = '';
let bridgeWindow: BrowserWindow | null = null;

export function setBridgeWindow(win: BrowserWindow | null) {
  bridgeWindow = win;
}

function bridgeDir() {
  return path.join(getDataDir(), 'bridge');
}

function cmdHelperScriptPath() {
  return path.join(bridgeDir(), 'open-url.cmd');
}

function shHelperScriptPath() {
  return path.join(bridgeDir(), 'open-url.sh');
}

function vbsHelperScriptPath() {
  return path.join(bridgeDir(), 'open-url.vbs');
}

/** Env injected into terminals so CLI tools route browser opens back into StackDock. */
export function getBridgeEnv(sessionId: string): Record<string, string> {
  if (!server) return {};
  const helper = process.platform === 'win32' ? cmdHelperScriptPath() : shHelperScriptPath();
  const plannotatorHelper = process.platform === 'win32'
    ? vbsHelperScriptPath()
    : process.platform === 'darwin'
      ? ':'
      : helper;
  return {
    STACKDOCK_BRIDGE_PORT: String(port),
    STACKDOCK_BRIDGE_TOKEN: token,
    STACKDOCK_SESSION_ID: sessionId,
    // Plannotator special-cases PLANNOTATOR_BROWSER on macOS as an app name
    // passed to `open -a`, so a helper script path would fail there. Use the
    // no-op sentinel on macOS so Plannotator falls back to BROWSER, which it
    // executes directly. Windows still needs a bare .vbs path for `cmd /c start`.
    PLANNOTATOR_BROWSER: plannotatorHelper,
    BROWSER: helper,
  };
}

// The scripts are static: they read port/token/session from env at runtime, so a
// stale script never embeds a stale token. Each falls back to the OS browser if
// the bridge is unreachable so terminal tools never silently fail.
const CMD_SCRIPT = `@echo off
setlocal
if "%~1"=="" exit /b 1
if "%STACKDOCK_BRIDGE_PORT%"=="" goto fallback
curl -s -f --max-time 3 -X POST "http://127.0.0.1:%STACKDOCK_BRIDGE_PORT%/open-url" -H "X-StackDock-Token: %STACKDOCK_BRIDGE_TOKEN%" -H "X-StackDock-Session: %STACKDOCK_SESSION_ID%" -H "Content-Type: text/plain" --data "%~1" >nul 2>&1
if errorlevel 1 goto fallback
exit /b 0
:fallback
start "" "%~1"
exit /b 0
`;

const SH_SCRIPT = `#!/bin/sh
url="$1"
[ -n "$url" ] || exit 1
if [ -n "$STACKDOCK_BRIDGE_PORT" ] && curl -s -f --max-time 3 -X POST "http://127.0.0.1:$STACKDOCK_BRIDGE_PORT/open-url" -H "X-StackDock-Token: $STACKDOCK_BRIDGE_TOKEN" -H "X-StackDock-Session: $STACKDOCK_SESSION_ID" -H "Content-Type: text/plain" --data "$url" >/dev/null 2>&1; then
  exit 0
fi
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"; elif command -v open >/dev/null 2>&1; then open "$url"; fi
`;

const VBS_SCRIPT = `Option Explicit
Dim args, url, shell, env, port, token, sessionId, http, target
Set args = WScript.Arguments
If args.Count = 0 Then WScript.Quit 1
url = args(0)
Set shell = CreateObject("WScript.Shell")
Set env = shell.Environment("PROCESS")
port = env("STACKDOCK_BRIDGE_PORT")
token = env("STACKDOCK_BRIDGE_TOKEN")
sessionId = env("STACKDOCK_SESSION_ID")
If Len(port) > 0 Then
  On Error Resume Next
  target = "http://127.0.0.1:" & port & "/open-url"
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.open "POST", target, False
  http.setTimeouts 1000, 1000, 3000, 3000
  http.setRequestHeader "X-StackDock-Token", token
  http.setRequestHeader "X-StackDock-Session", sessionId
  http.setRequestHeader "Content-Type", "text/plain"
  http.send url
  If Err.Number = 0 And http.status >= 200 And http.status < 300 Then WScript.Quit 0
  On Error GoTo 0
End If
shell.Run "rundll32 url.dll,FileProtocolHandler " & Chr(34) & url & Chr(34), 0, False
WScript.Quit 0
`;

async function writeHelperScripts() {
  await fs.mkdir(bridgeDir(), { recursive: true });
  await fs.writeFile(cmdHelperScriptPath(), CMD_SCRIPT, 'utf8');
  await fs.writeFile(vbsHelperScriptPath(), VBS_SCRIPT, 'utf8');
  const shPath = shHelperScriptPath();
  await fs.writeFile(shPath, SH_SCRIPT, 'utf8');
  await fs.chmod(shPath, 0o755).catch(() => undefined);
}

export async function startBrowserBridge() {
  if (server) return;
  token = crypto.randomUUID();
  await writeHelperScripts();
  server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/open-url') { res.statusCode = 404; res.end(); return; }
    if (req.headers['x-stackdock-token'] !== token) { res.statusCode = 403; res.end(); return; }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8192) req.destroy();
    });
    req.on('end', () => {
      const url = body.trim();
      if (!/^https?:\/\//i.test(url)) { res.statusCode = 400; res.end(); return; }
      const sessionHeader = req.headers['x-stackdock-session'];
      const sessionId = typeof sessionHeader === 'string' && sessionHeader ? sessionHeader : undefined;
      if (bridgeWindow && !bridgeWindow.isDestroyed()) {
        bridgeWindow.webContents.send('web:openUrlRequest', { url, sessionId });
      } else {
        void shell.openExternal(url).catch((error) => logError('bridge openExternal', error));
      }
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
}

export async function stopBrowserBridge() {
  const current = server;
  if (!current) return;
  server = null;
  port = 0;
  token = '';
  await new Promise<void>((resolve) => current.close(() => resolve()));
}
