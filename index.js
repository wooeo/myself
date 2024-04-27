const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync } = require('child_process');
const FILE_PATH = process.env.FILE_PATH || './tmp';  // 运行目录，节点保存目录
const projectPageURL = process.env.URL || '';      
const intervalInseconds = process.env.TIME || 120;   
const UUID = process.env.UUID || '00000000-0000-0000-0000-000000000000'; // UUID
const NEZHA_SERVER = process.env.NEZHA_SERVER || 'nz.abcd.cn';      // 哪吒客户端域名
const NEZHA_PORT = process.env.NEZHA_PORT || '5555';              // 哪吒端口为{443,8443,2096,2087,2083,2053}其中之一时开启tls
const NEZHA_KEY = process.env.NEZHA_KEY || '';                   // 哪吒客户端密钥             
const DOMAIN = process.env.DOMAIN || 'de2.bot-hosting.net';     // 分配的域名或反代后的域名，建议填反代后的域名                        
const NAME = process.env.NAME || 'Bot';                        // 节点名称              
const PORT = process.env.PORT || 3000;                       // http订阅端口,不用更改
const XY_PORT = process.env.SERVER_PORT || process.env.XY_PORT || 8080;  // xray端口，如果节点不通，可尝试填写分配的端口

//创建运行文件夹
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

//清理历史文件
const pathsToDelete = [ 'web', 'npm', 'sub.txt'];
function cleanupOldFiles() {
  pathsToDelete.forEach((file) => {
    const filePath = path.join(FILE_PATH, file);
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error(`Skip Delete ${filePath}`);
      } else {
        console.log(`${filePath} deleted`);
      }
    });
  });
}
cleanupOldFiles();

// 根路由
app.get("/", function(req, res) {
  res.send("Hello world!");
});

// 生成xr-ay配置文件
const config = {
  log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
  inbounds: [
    { port: XY_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless", dest: 3002 }, { path: "/vmess", dest: 3003 }, { path: "/trojan", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
    { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "ws", security: "none" } },
    { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
  ],
  dns: { servers: ["https+local://8.8.8.8/dns-query"] },
  outbounds: [
    { protocol: "freedom" },
    {
      tag: "WARP",
      protocol: "wireguard",
      settings: {
        secretKey: "YFYOAdbw1bKTHlNNi+aEjBM3BO7unuFC5rOkMRAz9XY=",
        address: ["172.16.0.2/32", "2606:4700:110:8a36:df92:102a:9602:fa18/128"],
        peers: [{ publicKey: "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=", allowedIPs: ["0.0.0.0/0", "::/0"], endpoint: "162.159.193.10:2408" }],
        reserved: [78, 135, 76],
        mtu: 1280,
      },
    },
  ],
  routing: { domainStrategy: "AsIs", rules: [{ type: "field", domain: ["domain:openai.com", "domain:ai.com"], outboundTag: "WARP" }] },
};
fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));

// 判断系统架构
function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return 'arm';
  } else {
    return 'amd';
  }
}

// 下载对应系统架构的依赖文件
function downloadFile(fileName, fileUrl, callback) {
  const filePath = path.join(FILE_PATH, fileName);
  const writer = fs.createWriteStream(filePath);

  axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream',
  })
    .then(response => {
      response.data.pipe(writer);

      writer.on('finish', () => {
        writer.close();
        console.log(`Download ${fileName} successfully`);
        callback(null, fileName);
      });

      writer.on('error', err => {
        fs.unlink(filePath, () => { });
        const errorMessage = `Download ${fileName} failed: ${err.message}`;
        console.error(errorMessage); // 下载失败时输出错误消息
        callback(errorMessage);
      });
    })
    .catch(err => {
      const errorMessage = `Download ${fileName} failed: ${err.message}`;
      console.error(errorMessage); // 下载失败时输出错误消息
      callback(errorMessage);
    });
}

// 下载并运行依赖文件
async function downloadFilesAndRun() {
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);

  if (filesToDownload.length === 0) {
    console.log(`Can't find a file for the current architecture`);
    return;
  }

  const downloadPromises = filesToDownload.map(fileInfo => {
    return new Promise((resolve, reject) => {
      downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, fileName) => {
        if (err) {
          reject(err);
        } else {
          resolve(fileName);
        }
      });
    });
  });

  try {
    await Promise.all(downloadPromises); // 等待所有文件下载完成
  } catch (err) {
    console.error('Error downloading files:', err);
    return;
  }

  // 授权和运行
  function authorizeFiles(filePaths) {
    const newPermissions = 0o775;

    filePaths.forEach(relativeFilePath => {
      const absoluteFilePath = path.join(FILE_PATH, relativeFilePath);

      fs.chmod(absoluteFilePath, newPermissions, (err) => {
        if (err) {
          console.error(`Empowerment failed for ${absoluteFilePath}: ${err}`);
        } else {
          console.log(`Empowerment success for ${absoluteFilePath}: ${newPermissions.toString(8)}`);
        }
      });
    });
  }
  const filesToAuthorize = ['./npm', './web'];
  authorizeFiles(filesToAuthorize);

  //运行ne-zha
  let NEZHA_TLS = '';
  if (NEZHA_SERVER && NEZHA_PORT && NEZHA_KEY) {
    const tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
    if (tlsPorts.includes(NEZHA_PORT)) {
      NEZHA_TLS = '--tls';
    } else {
      NEZHA_TLS = '';
    }
    const command = `nohup ${FILE_PATH}/npm -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} >/dev/null 2>&1 &`;
    try {
      await exec(command);
      console.log('npm is running');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`npm running error: ${error}`);
    }
  } else {
    console.log('NEZHA variable is empty,skip running');
  }

  //运行xr-ay
  const command1 = `nohup ${FILE_PATH}/web -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`;
  try {
    await exec(command1);
    console.log('web is running');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(`web running error: ${error}`);
  }
}
//根据系统架构返回对应的url
function getFilesForArchitecture(architecture) {
  if (architecture === 'arm') {
    return [
      { fileName: "npm", fileUrl: "https://github.com/eooce/test/releases/download/ARM/swith" },
      { fileName: "web", fileUrl: "https://github.com/eooce/test/releases/download/ARM/web" },
    ];
  } else if (architecture === 'amd') {
    return [
      { fileName: "npm", fileUrl: "https://github.com/eooce/test/raw/main/amd64" },
      { fileName: "web", fileUrl: "https://github.com/eooce/test/raw/main/web" },
    ];
  }
  return [];
}

// 获取临时隧道domain
async function generateLinks() {

    const metaInfo = execSync(
      'curl -s https://speed.cloudflare.com/meta | awk -F\\" \'{print $26"-"$18}\' | sed -e \'s/ /_/g\'',
      { encoding: 'utf-8' }
    );
    const ISP = metaInfo.trim();

    return new Promise((resolve) => {
      setTimeout(() => {
        const subTxt = `
vless://${UUID}@${DOMAIN}:${XY_PORT}?encryption=none&security=none&sni=${DOMAIN}&type=ws&host=${DOMAIN}&path=%2Fvless%3Fed%3D2048#${NAME}-${ISP}

    `;
        // 打印 sub.txt 内容到控制台
        console.log(Buffer.from(subTxt).toString('base64'));
        const filePath = path.join(FILE_PATH, 'sub.txt');
        fs.writeFileSync(filePath, Buffer.from(subTxt).toString('base64'));
        console.log(`${FILE_PATH}/sub.txt saved successfully`);
        // 将内容进行 base64 编码并写入 /sub 路由
        app.get('/sub', (req, res) => {
          const encodedContent = Buffer.from(subTxt).toString('base64');
          res.set('Content-Type', 'text/plain; charset=utf-8');
          res.send(encodedContent);
        });
        resolve(subTxt);
      }, 2000);
    });
}

// 1分钟后删除list,boot,config文件
const npmPath = path.join(FILE_PATH, 'npm');
const webPath = path.join(FILE_PATH, 'web');
const configPath = path.join(FILE_PATH, 'config.json');
function cleanFiles() {
  setTimeout(() => {
    exec(`rm -rf ${configPath} ${npmPath} ${webPath}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error while deleting files: ${error}`);
        return;
      }
      console.clear()
      console.log('App is running');
      console.log('Thank you for using this script, enjoy!');
    });
  }, 60000); // 60 秒
}
cleanFiles();

// 自动访问项目URL
let hasLoggedEmptyMessage = false;
async function visitProjectPage() {
  try {
    // 如果URL和TIME变量为空时跳过访问项目URL
    if (!projectPageURL || !intervalInseconds) {
      if (!hasLoggedEmptyMessage) {
        console.log("URL or TIME variable is empty,skip visit url");
        hasLoggedEmptyMessage = true;
      }
      return;
    } else {
      hasLoggedEmptyMessage = false;
    }

    await axios.get(projectPageURL);
    // console.log(`Visiting project page: ${projectPageURL}`);
    console.log('Page visited successfully');
    console.clear()
  } catch (error) {
    console.error('Error visiting project page:', error.message);
  }
}
setInterval(visitProjectPage, intervalInseconds * 1000);

// 回调运行
async function startserver() {
  await downloadFilesAndRun();
  await generateLinks();
  visitProjectPage();
}
startserver();

app.listen(PORT, () => console.log(`Http server is running on port:${PORT}!`));