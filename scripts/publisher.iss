; 小萝卜发版助手安装包：由 scripts/package-publisher.cjs 先生成 release\小萝卜发版助手\ 再编译。
#define AppName "小萝卜发版助手"
#include "..\release\publisher-version.iss"
#define AppExe AppName + ".exe"
#define BuildDir "..\release\" + AppName

[Setup]
AppId={{c192e7a5-16a2-436a-b8eb-e4959048fb0a}
AppName={#AppName}
AppVersion={#PublisherVersion}
AppVerName={#AppName} v{#PublisherVersion}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableProgramGroupPage=yes
WizardStyle=modern
SetupIconFile=..\public\app-icon.ico
UninstallDisplayIcon={app}\{#AppExe}
OutputDir=..\release\installer
OutputBaseFilename={#AppName}-Setup
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"

[Files]
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
Type: filesandordirs; Name: "{app}\resources\app"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"
Name: "{group}\卸载{#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "启动{#AppName}"; Flags: nowait postinstall skipifsilent
