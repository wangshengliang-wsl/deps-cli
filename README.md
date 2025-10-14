# deps-cli

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

A CLI tool to manage dependencies in your project

## Requirements
- Node.js >= 20.0.0
- 配置host

## Features
> #### <p>📦&nbsp; input many packages to install</p> ####
> #### <p>🚀&nbsp; show your beetle development branches</p> ####
> #### <p>🚗&nbsp; auto install dependencies</p> ####
> #### <p>🚑&nbsp; auto commit dependencies</p> ####
> #### <p>🚒&nbsp; auto push dependencies</p> ####

## Install
```bash
npm install -g deps-cli
```

## Usage
```bash
deps
```

## Configuration
```ini
# ~/deps-cli.ini
[auth]
username=xxx #登录用户名
password=xxx #登录密码
cookies="xxx" #登录cookies

[projects]
root=xxx #本地项目根目录

[hosts] # host配置，敏感信息请自行配置
loginHost=xxx #sso登录认证 host
beetleHost=xxx #beetle host
qaCodeHost=xxx #qacode host

[presets]
data={} #预设数据
```

## License

[MIT](./LICENSE) License © 2024-PRESENT [Joruno-w](https://github.com/Joruno-w)

<video src="https://github.com/user-attachments/assets/613439ef-86c1-4370-8d7a-f095c4d98bc1" />

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/deps-cli?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/deps-cli
[npm-downloads-src]: https://img.shields.io/npm/dm/deps-cli?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/deps-cli
[bundle-src]: https://img.shields.io/bundlephobia/minzip/deps-cli?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=deps-cli
[license-src]: https://img.shields.io/github/license/Joruno-w/deps-cli.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/Joruno-w/deps-cli/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/deps-cli
