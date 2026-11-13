; 增量更新包：由 scripts/package-update.cjs 生成文件清单后编译，不要单独编译。
#define AppName "小萝卜游戏控制台"
#define AppExe AppName + ".exe"
#ifndef UpdateDir
  #error 请用 npm run package:update 生成更新包
#endif
#include UpdateDir + "\update-version.iss"

[Setup]
AppId={{e4f9a4cd-b401-427a-9c9c-be7a057d9ea7}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} v{#AppVersion} 更新包
DefaultDirName={localappdata}\Programs\{#AppName}
UsePreviousAppDir=yes
DisableDirPage=auto
DisableProgramGroupPage=yes
DisableReadyPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
SetupIconFile=..\public\app-icon.ico
Uninstallable=no
CreateUninstallRegKey=no
OutputDir=..\release\installer
OutputBaseFilename={#AppName}-v{#AppVersion}-更新包
Compression=lzma2/ultra64
SolidCompression=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Messages]
WelcomeLabel2=这会把[name/ver]装到已经安装的小萝卜游戏控制台上，只替换改过的文件，设置和数据都会保留。%n%n可以从 {#FromList} 直接升级。更早的版本请下载完整安装包。
SelectDirLabel3=没找到安装记录。请选择小萝卜游戏控制台所在的文件夹（里面有「{#AppExe}」）。

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

#include UpdateDir + "\update-delete.iss"
#if ReplaceDeps
Type: filesandordirs; Name: "{app}\resources\app\node_modules"
#endif

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{e4f9a4cd-b401-427a-9c9c-be7a057d9ea7}_is1"; ValueType: string; ValueName: "DisplayVersion"; ValueData: "{#AppVersion}"; Check: IsRegisteredInstall
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{e4f9a4cd-b401-427a-9c9c-be7a057d9ea7}_is1"; ValueType: string; ValueName: "DisplayName"; ValueData: "{#AppName} v{#AppVersion}"; Check: IsRegisteredInstall

[Run]
Filename: "{app}\{#AppExe}"; Description: "启动{#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
const
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{e4f9a4cd-b401-427a-9c9c-be7a057d9ea7}_is1';

function ReadText(const FileName: String): String;
var
  Text: AnsiString;
begin
  Result := '';
  if LoadStringFromFile(FileName, Text) then Result := Trim(String(Text));
end;

// 从 resources\app\package.json 读出已装的版本号。
function InstalledVersion(const Dir: String): String;
var
  S: String;
  P: Integer;
begin
  Result := '';
  S := ReadText(AddBackslash(Dir) + 'resources\app\package.json');
  P := Pos('"version"', S);
  if P = 0 then Exit;
  Delete(S, 1, P + 8);
  P := Pos('"', S);
  if P = 0 then Exit;
  Delete(S, 1, P);
  P := Pos('"', S);
  if P = 0 then Exit;
  Result := Copy(S, 1, P - 1);
end;

// 更新的是安装版（不是拷出来的免安装版）时，顺便把「应用和功能」里的版本号改掉。
function IsRegisteredInstall: Boolean;
var
  Location: String;
begin
  Result := RegQueryStringValue(HKCU, UninstallKey, 'InstallLocation', Location) and (CompareText(AddBackslash(Location), AddBackslash(ExpandConstant('{app}'))) = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Dir, Version: String;
begin
  Result := '';
  Dir := ExpandConstant('{app}');
  if not FileExists(AddBackslash(Dir) + '{#AppExe}') then
  begin
    Result := '这个文件夹里没有小萝卜游戏控制台，请先安装完整版。';
    Exit;
  end;
  Version := InstalledVersion(Dir);
  if Version = '' then
  begin
    Result := '读不到已安装的版本号，请下载完整安装包重新安装。';
    Exit;
  end;
  if Pos('|' + Version + '|', '{#AllowedVersions}') = 0 then
  begin
    Result := '已安装的是 v' + Version + '，这个更新包只能从 {#FromList} 升级。请下载 v{#AppVersion} 的完整安装包。';
    Exit;
  end;
  if ReadText(AddBackslash(Dir) + 'version') <> '{#ElectronVersion}' then
  begin
    Result := '已安装的运行环境和这个更新包不配套，请下载 v{#AppVersion} 的完整安装包。';
    Exit;
  end;
  // 程序还开着时 exe 写不进去：借此判断要先关掉。
  if not SaveStringToFile(AddBackslash(Dir) + '{#AppExe}', '', True) then
  begin
    Result := '小萝卜游戏控制台还开着，请先关掉它（包括托盘里的），再点「上一步」后重新「安装」。';
    Exit;
  end;
end;
