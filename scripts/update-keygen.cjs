// 生成推送更新用的签名密钥（只需运行一次）：npm run update:keygen
// 私钥只放在本机 %USERPROFILE%\.xiaoluobo-release\，千万别提交、别发给别人；公钥写进 lib/update-key.cjs 打进程序。
// 私钥丢了就再也推不了更新（只能让大家手动装一个带新公钥的版本），请自己另外备份一份。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const dir = path.join(os.homedir(), '.xiaoluobo-release');
const keyFile = path.join(dir, 'update-signing-key.pem');
const target = path.join(__dirname, '..', 'lib', 'update-key.cjs');
fs.mkdirSync(dir, { recursive: true });
if (fs.existsSync(keyFile) && !process.argv.includes('--force')) {
  console.log(`已经有签名私钥：${keyFile}（要换新的加 --force，换了以后旧版本程序就收不到推送了）`);
} else {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`已生成签名私钥：${keyFile}`);
}
const publicKey = crypto.createPublicKey(fs.readFileSync(keyFile)).export({ type: 'spki', format: 'der' }).toString('base64');
fs.writeFileSync(target, `// 推送更新的签名公钥（由 scripts/update-keygen.cjs 生成）。程序只接受用对应私钥签过名的更新清单。\nmodule.exports = { UPDATE_PUBLIC_KEY: '${publicKey}' };\n`);
console.log(`公钥已写入 ${path.relative(process.cwd(), target)}`);
