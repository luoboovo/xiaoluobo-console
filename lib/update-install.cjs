// 安装下载好的更新：起一个隐藏的 PowerShell，等控制台完全退出（exe 不再被占用），
// 静默装进当前程序所在的文件夹（免安装版也装对地方），装完重新打开控制台。
const { spawn } = require('node:child_process');
const path = require('node:path');

const quote = text => `'${String(text).replaceAll("'", "''")}'`;
function installScript({ installer, appExe, pid }) {
  const dir = path.dirname(appExe);
  return [
    `$exe = ${quote(appExe)}`,
    `Wait-Process -Id ${Number(pid)} -Timeout 60 -ErrorAction SilentlyContinue`,
    // Electron 的子进程和主程序是同一个 exe，全部退出后才能覆盖文件。
    '$deadline = (Get-Date).AddSeconds(30)',
    'while ((Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }',
    `Start-Process -FilePath ${quote(installer)} -ArgumentList @('/SILENT', '/SP-', '/NOCANCEL', '/NORESTART', ${quote(`/DIR="${dir}"`)}) -Wait`,
    'Start-Process -FilePath $exe'
  ].join('\r\n');
}
function launchInstaller({ installer, appExe = process.execPath, pid = process.pid, spawnImpl = spawn }) {
  const encoded = Buffer.from(installScript({ installer, appExe, pid }), 'utf16le').toString('base64');
  // 两个坑：① 普通子进程被 Node 放进「主程序退出就一起结束」的作业里，必须 detached 才能活过控制台退出；
  // ② detached 的 PowerShell 没有控制台，一启动就直接退出、什么都不做。
  // 所以 detached 起一个 cmd，用 start 另开一个独立的 PowerShell（自己有控制台，-WindowStyle Hidden 藏起来）。
  const child = spawnImpl('cmd.exe', ['/d', '/c', 'start', '""', '/min', 'powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
module.exports = { installScript, launchInstaller };
