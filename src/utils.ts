import chalk from 'chalk'
import fetch from 'node-fetch'
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import ini from 'ini';

const customRcPath = process.env.NI_CONFIG_FILE

const home = process.platform === 'win32'
  ? process.env.USERPROFILE
  : process.env.HOME

const defaultRcPath = path.join(home || '~/', '.deps-cli.ini')

const CONFIG_FILE = customRcPath || defaultRcPath

const uuid = generateUUID()
// 识别验证码
async function recognizeQRCode() {
  const worker = await createWorker();
  try {
    await worker.reinitialize('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    });
    const response = await fetch(`https://zzsso.zhuanspirit.com/external/getValidateCode?key=${uuid}`);
    const data: any = await response.json();
    const imageBase64 = data?.data;

    // 使用sharp处理图片
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const processedImage = await sharp(imageBuffer)
      .threshold(128)
      .toBuffer();
    const processedBase64 = processedImage.toString('base64');
    const { data: { text } } = await worker.recognize(`data:image/png;base64,${processedBase64}`);
    return text;

  } catch (error) {
    console.error('OCR识别失败:', error);
    throw error;
  } finally {
    await worker.terminate();
  }
}

// 生成 UUID
function generateUUID() {
  const buffer = crypto.randomBytes(16);

  // 设置 UUID 版本为 4
  buffer[6] = (buffer[6] & 0x0f) | 0x40;
  // 设置 UUID 变体为 RFC 4122
  buffer[8] = (buffer[8] & 0x3f) | 0x80;

  const hex = buffer.toString('hex');

  const uuid = [
    hex.substr(0, 8),
    hex.substr(8, 4),
    hex.substr(12, 4),
    hex.substr(16, 4),
    hex.substr(20, 12)
  ].join('-').toLowerCase();

  return uuid;
}

// 添加轮询工具函数
async function retry(fn: Function, maxAttempts = 3, delay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (result.cookies) {
        return result;
      }
      throw new Error('未获取到 cookies');
    } catch (error) {
      lastError = error;
      console.log(chalk.yellow(`第 ${attempt} 次尝试登录失败，你特么是不是连VPN了，${attempt < maxAttempts ? '等待重试' : '达到最大重试次数'}`));
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// 修改登录函数
async function login() {
  async function attemptLogin() {
    // 1. 获取验证码
    const graphicsCode = await recognizeQRCode();
    if (!graphicsCode) {
      throw new Error('验证码识别失败');
    }

    // 从配置文件获取凭证
    const config = await loadConfig();
    const { username, password } = config.auth || {};
    
    if (!username || !password) {
      throw new Error('未配置用户名或密码，请先配置凭证');
    }

    // 2. 构建登录参数
    const loginParams = {
      company: '0',
      userName: username,
      password: password,
      graphicsCode: `${graphicsCode.trim()}`,
      key: `${uuid}`,
      appType: '0'
    };

    const requestOptions = {
      credentials: 'include',
      method: "POST",
      body: new URLSearchParams(loginParams),
    };

    // 3. 发送登录请求
    const response = await fetch('https://zzsso.zhuanspirit.com/external/login', requestOptions);
    const result: any = await response.json();
    const cookies = response.headers.get('set-cookie');

    if (!cookies) {
      throw new Error('登录成功但未获取到 cookies');
    }

    return {
      cookies,
      data: result.data
    };
  }
  try {
    return await retry(attemptLogin, 3, 3000);
  } catch (error) {
    console.error('登录失败:', error);
    throw error;
  }
}

// 配置文件管理
async function loadConfig() {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    const config = ini.parse(content);
    // 确保基本结构存在
    return {
      auth: config.auth || {},
      projects: config.projects || { root: '' },
      presets: config.presets || { data: '{}' }
    };
  } catch {
    // 返回默认配置
    return {
      auth: {},
      projects: { root: '' },
      presets: { data: '{}' }
    };
  }
}

async function saveConfig(config: any) {
  await fs.writeFile(CONFIG_FILE, ini.stringify(config));
}

// cookie 管理相关函数
async function saveCookies(cookies: string) {
  const config = await loadConfig();
  config.auth.cookies = cookies;
  await saveConfig(config);
}

async function loadCookies() {
  const config = await loadConfig();
  return config.auth.cookies;
}

// 修改 request 函数的重试逻辑
async function request(url: string, options: RequestInit = {}) {
  // 尝试加载存储的 cookies
  let cookies = await loadCookies();
  // 合并默认配置
  const requestOptions: any = {
    headers: {
      ...options.headers,
      ...(cookies ? { 'Cookie': cookies } : {})
    },
    ...options
  };
  let response: any = {}
  try {
    // 第一次尝试请求
    response = await fetch(url, requestOptions).then(res => res.json())
  } catch (error) {
    // 使用轮询重试登录
    const { cookies } = await retry(login, 3, 2000);
    await saveCookies(cookies);
    // 使用新的 cookies 重试请求
    requestOptions.headers['Cookie'] = cookies;
    response = await fetch(url, requestOptions).then(res => res.json());
  }
  return response?.respData || {}
}

// 修改 getBranches 函数使用新的请求函数
interface Branch {
  branchName: string;
  engineType: string;
  createor: string;
  workItem: string;
}

async function getBranches(): Promise<Branch[]> {
  const params = {
    p_pageIndex: 1,
    projectId: 0,
    branchState: 1,
  };
  try {
    const branches = await request(
      `https://beetle.zhuanspirit.com/apiBeetle/project/branchingmyself?${toParams(params)}`,
      { method: 'GET' }
    );
    return branches.datalist.filter((b: any) => b.engineType == 'fe')
  } catch (error) {
    console.error('获取分支信息失败:', error);
    throw error;
  }
}

// 修改 updateCdnUrls 函数使用新的请求函数
async function updateCdnUrls(urls: string[]) {
  return await request('https://order.zhuanspirit.com/api/apply_order/CdnUrls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      urls: urls.join('\n'),
    }),
  });
}

function toParams(params: Record<string, any>): string {
  let paramsStr = ''
  Object.entries(params).forEach(([key, value]) => {
    paramsStr += paramsStr ? `&${key}=${value}` : `${key}=${value}`
  })
  return paramsStr
}


export {
  recognizeQRCode,
  login,
  saveCookies,
  loadCookies,
  request,
  getBranches,
  updateCdnUrls,
  toParams,
  generateUUID,
  uuid,
  loadConfig,
  saveConfig,
}
