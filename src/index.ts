#!/usr/bin/env node
import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import chalk from 'chalk'
import prompts from 'prompts'
import { program } from 'commander'
import { getBranches, CONFIG_FILE, loadConfig, saveConfig } from './utils'
import packageJson from '../package.json'


// 添加 commander 配置
program
  .version(packageJson.version, '-v, --version', '显示版本号')
  .description('一个用于批量更新依赖的CLI工具')
  .helpOption('-h, --help', '显示帮助信息')
  .addHelpText('after', `
示例:
  $ deps              运行交互式更新依赖向导
  $ deps -v           显示版本号
  $ deps -h           显示帮助信息
`)

program.parse(process.argv)

// 如果没有其他参数,执行主程序
if (!process.argv.slice(2).length) {
  main().catch(console.error)
}

function loadRootDir() {
  const config = loadConfig()
  return config.projects.root
}

function saveRootDir(rootDir: string) {
  const config = loadConfig()
  config.projects.root = rootDir
  saveConfig(config)
}

function loadPresets() {
  const config = loadConfig()
  return JSON.parse(config.presets.data || '{}')
}

function savePreset(name: string, presetConfig: any) {
  const config = loadConfig()
  const presets = JSON.parse(config.presets.data || '{}')
  presets[name] = presetConfig
  config.presets.data = JSON.stringify(presets)
  saveConfig(config)
}

// 添加用户凭证相关函数
function loadCredentials() {
  const config = loadConfig()
  return {
    username: config.auth?.username,
    password: config.auth?.password,
  }
}

function saveCredentials(username: string, password: string) {
  const config = loadConfig()
  config.auth = {
    ...config.auth,
    username,
    password,
  }
  saveConfig(config)
}

// 处理 ctrl+c
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n操作已取消'))
  process.exit(0)
})

// 验证单个包名和版本
function validatePackage(name: string, version: string) {
  if (!name)
    return '请输入包名'
  if (!version)
    return '请输入版本号'
  const versionRegex = /^\d+\.\d+\.\d+(-beta|-alpha|-rc)?(\.\d+)?$/
  if (!versionRegex.test(version)) {
    return '版本号格式错误'
  }
  return true
}

// 包配置输入函数
async function inputPackages(initialPackages = []) {
  const packages: any[] = [...initialPackages]
  let continueAdding = true

  while (continueAdding) {
    const response = await prompts([
      {
        type: 'text',
        name: 'name',
        message: '请输入包名',
        initial: '@zz-common/zz-ui',
        validate: (value) => {
          const result = validatePackage(value, '0.0.0')
          return result === true ? true : result
        },
      },
      {
        type: 'text',
        name: 'version',
        message: prev => `请输入 ${prev} 的版本号`,
        initial: '6.3.56',
        validate: (value) => {
          const result = validatePackage('@zz-common/zz-ui', value)
          return result === true ? true : result
        },
      },
      {
        type: 'confirm',
        name: 'addMore',
        message: '是否继续添加包？',
        initial: false,
      },
    ])

    if (!response.name || !response.version) {
      console.log(chalk.yellow('\n操作已取消'))
      return null
    }

    packages.push({ name: response.name, version: response.version })

    // 显示当前已添加的包
    console.log(`\n${chalk.green('当前已添加的包：')}`)
    packages.forEach(({ name, version }) => {
      console.log(chalk.cyan(`${name}@${version}`))
    })
    console.log()

    continueAdding = response.addMore
  }

  return packages
}

// 项目目录操作函数
async function getRootDir() {
  let rootDir = loadRootDir()

  if (!rootDir) {
    const { inputPath } = await prompts({
      type: 'text',
      name: 'inputPath',
      message: '请输入项目根目录绝对路径',
      validate: value => value ? true : '路径不能为空',
    })

    if (!inputPath) {
      throw new Error('未提供项目根目录路径')
    }

    rootDir = path.resolve(inputPath)
    saveRootDir(rootDir)
  }

  return rootDir
}

// 获取项目路径
async function getProjectPath(projectName: string) {
  const rootDir = await getRootDir()
  const projectPath = path.join(rootDir, projectName)

  try {
    await fs.access(projectPath)
  }
  catch {
    throw new Error(`在 ${rootDir} 下未找到项目 ${projectName}`)
  }

  return projectPath
}

// 添加检查和切换分支的函数
async function checkAndSwitchBranch(projectPath: string, targetBranch: string) {
  try {
    // 获取当前分支
    const currentBranch = execSync('git branch --show-current', {
      cwd: projectPath,
      encoding: 'utf8',
    }).trim();

    if (currentBranch !== targetBranch) {
      const { shouldSwitch } = await prompts({
        type: 'confirm',
        name: 'shouldSwitch',
        message: `本地分支(${chalk.greenBright(currentBranch)})和选择分支(${chalk.greenBright(targetBranch)})不一致，是否切换？`,
        initial: true,
      });

      if (shouldSwitch) {
        execSync(`git checkout ${targetBranch}`, {
          cwd: projectPath,
          stdio: 'pipe',
        });
        return true;
      }
      return false;
    }
    return true;
  } catch (error: any) {
    console.log(chalk.red(`获取或切换分支失败: ${error.message}`));
    return false;
  }
}

// git操作和依赖安装函数
async function updateLocalProject(projectPath: string, statusManager: any, packages: any[], branch: string) {
  const projectName = path.basename(projectPath)
  try {
    statusManager.initProject(projectName)

    // 检查并切换分支
    const branchSwitched = await checkAndSwitchBranch(projectPath, branch);
    if (!branchSwitched) {
      throw new Error('分支切换失败或被用户取消');
    }

    // Git Pull
    statusManager.updateProject(projectName, '处理中', '执行 git pull')
    execSync('git pull', { cwd: projectPath, stdio: 'ignore' })

    // Node 版本切换
    const nvmrcPath = path.join(projectPath, '.nvmrc')
    let nodeVersion
    try {
      nodeVersion = (await fs.readFile(nvmrcPath, 'utf-8')).trim()
      statusManager.updateProject(projectName, '处理中', `检测到 Node.js 版本: ${nodeVersion}`)
    }
    catch (error) {
      nodeVersion = '14'
      statusManager.updateProject(projectName, '处理中', '使用默认 Node.js 版本: 14')
    }

    // 切换 node 版本
    const majorVersion = nodeVersion.split('.')[0]
    const home = process.env.HOME || process.env.USERPROFILE
    const nvmCommand = `. "${home}/.nvm/nvm.sh" && nvm use ${majorVersion}`

    execSync(nvmCommand, {
      shell: '/bin/bash',
      stdio: 'ignore',
      env: {
        ...process.env,
        NVM_DIR: `${home}/.nvm`,
      },
    })

    // 检测包管理器
    const hasYarn = await fs.access(path.join(projectPath, 'yarn.lock'))
      .then(() => true)
      .catch(() => false)
    const hasPnpm = await fs.access(path.join(projectPath, 'pnpm-lock.yaml'))
      .then(() => true)
      .catch(() => false)

    // 安装新依赖
    statusManager.updateProject(projectName, '处理中', '安装新添加的依赖')
    const packageStrings = packages.map(({ name, version }) => `${name}@${version}`)

    try {
      if (hasPnpm) {
        statusManager.updateProject(projectName, '处理中', '使用 pnpm 安装新依赖')
        execSync(`pnpm add ${packageStrings.join(' ')} --no-strict-peer-dependencies`, {
          cwd: projectPath,
          stdio: 'pipe',
          env: {
            ...process.env,
            PATH: `${process.env.NVM_DIR}/versions/node/v${nodeVersion}/bin:${process.env.PATH}`,
            NPM_CONFIG_REGISTRY: 'https://rcnpm.zhuanspirit.com/',
          },
        })
      }
      else if (hasYarn) {
        statusManager.updateProject(projectName, '处理中', '使用 yarn 安装新依赖')
        execSync(`yarn add ${packageStrings.join(' ')} --ignore-engines`, {
          cwd: projectPath,
          stdio: 'pipe',
          env: {
            ...process.env,
            PATH: `${process.env.NVM_DIR}/versions/node/v${nodeVersion}/bin:${process.env.PATH}`,
            NPM_CONFIG_REGISTRY: 'https://rcnpm.zhuanspirit.com/',
          },
        })
      }
      else {
        statusManager.updateProject(projectName, '处理中', '使用 npm 安装新依赖')
        execSync(`npm install ${packageStrings.join(' ')} --legacy-peer-deps`, {
          cwd: projectPath,
          stdio: 'pipe',
          env: {
            ...process.env,
            PATH: `${process.env.NVM_DIR}/versions/node/v${nodeVersion}/bin:${process.env.PATH}`,
            NPM_CONFIG_REGISTRY: 'https://rcnpm.zhuanspirit.com/',
          },
        })
      }

      // Git 提交前配置用户信息
      statusManager.updateProject(projectName, '处理中', '配置 Git 用户信息')
      const gitConfig: any = await getGitConfig()

      execSync(`git config user.name "${gitConfig.name}"`, {
        cwd: projectPath,
        stdio: 'ignore',
      })
      execSync(`git config user.email "${gitConfig.email}"`, {
        cwd: projectPath,
        stdio: 'ignore',
      })

      // Git 操作
      statusManager.updateProject(projectName, '处理中', '提交更改')
      execSync('git add .', {
        cwd: projectPath,
        stdio: 'pipe', // 改为 pipe 以捕获可能的错误
      })

      const commitMessage = `feat: 更新依赖 ${packageStrings.join(', ')}`
      try {
        execSync('git diff --staged --quiet', {
          cwd: projectPath,
          stdio: 'ignore',
        })
        statusManager.updateProject(projectName, '处理中', '无变更需要提交')
      }
      catch (error) {
        // 有变更需要提交
        execSync(`git commit -m "${commitMessage}" --no-verify`, {
          cwd: projectPath,
          stdio: 'pipe',
        })

        statusManager.updateProject(projectName, '处理中', '推送更改')
        execSync('git push', {
          cwd: projectPath,
          stdio: 'pipe',
        })
      }

      statusManager.updateProject(projectName, '成功', '项目更新完成')
    }
    catch (error: any) {
      // 如果有错误输出，将其添加到错误信息中
      const errorOutput = error.stderr ? `\n${error.stderr.toString()}` : ''
      throw new Error(`操作失败`)
    }
  }
  catch (error: any) {
    statusManager.updateProject(projectName, '失败', `${error.message}`)
    throw error
  }
}

// 修改预设管理函数
async function managePresets(presets: any) {
  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: '请选择操作',
    choices: [
      { title: '使用预设', value: 'use' },
      { title: '删除预设', value: 'delete' },
      { title: '创建新配置', value: 'new' },
    ],
  })

  if (action === 'delete') {
    const { presetToDelete } = await prompts({
      type: 'select',
      name: 'presetToDelete',
      message: '选择要删除的预设',
      choices: Object.keys(presets).map(name => ({
        title: name,
        value: name,
      })),
    })

    if (presetToDelete) {
      delete presets[presetToDelete]
      await fs.writeFile(CONFIG_FILE, JSON.stringify(presets, null, 2)) // 将 PRESETS_FILE 改为 CONFIG_FILE
      console.log(chalk.green('预设删除成功！'))
    }
    return { action: 'delete' }
  }

  if (action === 'use') {
    const { selectedPreset } = await prompts({
      type: 'select',
      name: 'selectedPreset',
      message: '选择要使用的预设',
      choices: Object.keys(presets).map(name => ({
        title: name,
        value: presets[name],
      })),
    })

    return { action: 'use', preset: selectedPreset }
  }

  return { action: 'new' }
}

// 添加终端输出控制函数
function clearLines(count: number) {
  process.stdout.moveCursor(0, -count)
  process.stdout.clearScreenDown()
}

// 修改项目状态管理类
interface Package {
  name: string;
  version: string;
}

interface ProjectConfig {
  packages: Package[];
  branches: string[];
  originBranches?: any[];
}

class ProjectStatus {
  private projects: Map<string, {
    name: string;
    status: string;
    details: string[];
    currentStep: string;
  }>;
  private displayedLines: number;
  private maxDetailsToShow: number;

  constructor() {
    this.projects = new Map()
    this.displayedLines = 0
    this.maxDetailsToShow = 5 // 每个项目最多显示最新的5条状态
  }

  initProject(projectName: string) {
    if (!this.projects.has(projectName)) {
      this.projects.set(projectName, {
        name: projectName,
        status: '等待处理',
        details: [],
        currentStep: '',
      })
    }
  }

  updateProject(projectName: string, status: string, detail = '') {
    const project = this.projects.get(projectName)
    if (project) {
      project.status = status
      project.currentStep = detail
      project.details.push(detail)
      // 只保留最新的几条记录
      if (project.details.length > this.maxDetailsToShow) {
        project.details = project.details.slice(-this.maxDetailsToShow)
      }
      this.display()
    }
  }

  display() {
    // 清除之前的输出
    if (this.displayedLines > 0) {
      clearLines(this.displayedLines)
    }

    let output = '\n项目状态：\n'
    this.displayedLines = 2

    for (const [name, project] of this.projects) {
      // 项目名称和当前状态
      output += chalk.bold(`\n${name}:`)
      output += ` ${this.getStatusColor(project.status)(project.status)}`
      output += project.currentStep ? ` - ${project.currentStep}` : ''
      output += '\n'
      this.displayedLines += 2

      // 显示历史记录
      const history = project.details.slice(0, -1) // 除去当前步骤
      if (history.length > 0) {
        this.displayedLines += 1

        history.forEach((detail) => {
          output += chalk.greenBright(`  ✓ ${detail}\n`)
          this.displayedLines += 1
        })
      }
    }

    process.stdout.write(output)
  }

  getStatusColor(status: string) {
    switch (status) {
      case '处理中': return chalk.blue
      case '成功': return chalk.green
      case '失败': return chalk.red
      default: return chalk.yellow
    }
  }
}

// 添加 git 配置读取函数
async function getGitConfig() {
  try {
    const name = execSync('git config --global user.name', { encoding: 'utf8' }).trim()
    const email = execSync('git config --global user.email', { encoding: 'utf8' }).trim()
    return { name, email }
  }
  catch (error) {
    console.log(chalk.yellow('未找到全局 git 配置'))
  }
}

async function main() {
  try {
    // 设置项目根目录
    const rootDir = await getRootDir()
    console.log(chalk.blue(`项目根目录: ${rootDir}`))

    // 验证根目录
    try {
      await fs.access(rootDir)
    }
    catch {
      console.log(chalk.red('项目根目录不存在，请重新设置'))
      await saveRootDir('') // 清空配置
      return main()
    }

    // 获取用户凭证
    let { username, password } = await loadCredentials()

    if (!username || !password) {
      const credentials = await prompts([
        {
          type: 'text',
          name: 'username',
          message: '请输入用户名（只需要输入一次）',
          validate: value => value ? true : '用户名不能为空',
        },
        {
          type: 'password',
          name: 'password',
          message: '请输入密码（只需要输入一次）',
          validate: value => value ? true : '密码不能为空',
        },
      ])

      if (!credentials.username || !credentials.password) {
        console.log(chalk.yellow('操作已取消'))
        return
      }

      ({ username, password } = credentials)
      await saveCredentials(username, password)
    }

    const presets = loadPresets()
    const hasPresets = Object.keys(presets).length > 0
    let config: any = {}

    if (hasPresets) {
      const { action, preset } = await managePresets(presets)
      if (action === 'delete') {
        return main()
      }
      if (action === 'use' && preset) {
        config = preset
      }
    }

    if (!config.packages || !config.branches) {
      const packages = await inputPackages()
      if (!packages) {
        return
      }

      config.packages = packages

      const branches = await getBranches()
      const { selectedBranches } = await prompts({
        type: 'multiselect',
        name: 'selectedBranches',
        message: '请选择要更新的分支',
        choices: branches?.map(branch => ({
          title: branch.branchName,
          value: branch.branchName,
          description: `${branch.createor} - ${branch.workItem.split('@%@').at(-1)}`,
        })) || [],
        min: 1,
        instructions: `
    ↑/↓: 选择当前分支
    ←/→/[space]: 切换选择状态
    a: 全选所有分支
    enter/return: 完成选择`,
      })

      if (!selectedBranches) {
        console.log(chalk.yellow('操作已取消'))
        return
      }

      config.originBranches = branches
      config.branches = selectedBranches

      if (packages && selectedBranches) {
        const { saveAsPreset } = await prompts({
          type: 'confirm',
          name: 'saveAsPreset',
          message: '是否保存为预设配置？',
          initial: false,
        })

        if (saveAsPreset) {
          const { presetName } = await prompts({
            type: 'text',
            name: 'presetName',
            message: '请输入预设配置名称',
            validate: value => value.length > 0 ? true : '请输入有效的名称',
          })

          if (presetName) {
            savePreset(presetName, config)
            console.log(chalk.green(`预设配置 "${presetName}" 已保存`))
          }
        }
      }
    }

    // 执行更新操作
    const statusManager = new ProjectStatus()
    for (const branch of config?.branches) {
      try {
        // 提取项目名并更新本地项目
        const projectName = branch.split('-')[0]
        try {
          const projectPath = await getProjectPath(projectName)
          await updateLocalProject(projectPath, statusManager, config.packages, branch)
        }
        catch (error) {
          statusManager.initProject(projectName)
          statusManager.updateProject(projectName, '失败')
        }
      }
      catch (error: any) {
        console.log(chalk.red(`分支 ${branch} 更新失败：${error.message}`))
      }
    }
  }
  catch (error: any) {
    console.log(chalk.red(`执行出错：${error.message}`))
    process.exit(1)
  }
}
