#define AppName "小萝卜游戏控制台"
#include "..\release\app-version.iss"
#define AppExe AppName + ".exe"
#define BuildDir "..\release\" + AppName + "-v" + AppVersion

[Setup]
AppId={{e4f9a4cd-b401-427a-9c9c-be7a057d9ea7}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} v{#AppVersion}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableDirPage=no
DisableProgramGroupPage=no
WizardStyle=modern
SetupIconFile=..\public\app-icon.ico
UninstallDisplayIcon={app}\resources\app\public\app-icon.ico
OutputDir=..\release\installer
OutputBaseFilename={#AppName}-v{#AppVersion}-Setup
Compression=lzma2/ultra64
SolidCompression=yes
LZMADictionarySize=262144
LZMANumFastBytes=273
LZMAUseSeparateProcess=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"

[Files]
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
Type: files; Name: "{app}\locales\*.pak"
Type: files; Name: "{app}\resources\default_app.asar"
Type: files; Name: "{app}\resources\app\public\noodle\assets\chef-body.png"
Type: files; Name: "{app}\resources\app\public\noodle\assets\chef-hand.png"
Type: files; Name: "{app}\resources\app\data\*.luobo"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; IconFilename: "{app}\resources\app\public\app-icon.ico"
Name: "{group}\卸载{#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon; IconFilename: "{app}\resources\app\public\app-icon.ico"

[Run]
Filename: "{app}\{#AppExe}"; Description: "启动{#AppName}"; Flags: nowait postinstall skipifsilent
