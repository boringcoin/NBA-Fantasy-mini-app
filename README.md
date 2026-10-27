# Thunder Fantasy

Mac / Windows 桌面比分与 Yahoo Fantasy 篮球分析工具。读取使用者自己已登录的 Yahoo 页面，在本机整理球员统计、全盟战力、两两对战、实际对局、走位与险胜；可独立导出 HTML、Excel 和图片。

日常使用不需要 Codex、Node.js、Python 或模型 API。每位使用者独立配置和配对，安装包不包含作者的联盟、账号、登录或个人缓存。

## 下载和连接自己的球队

首次使用请看 [Mac / Windows 简易安装教程](简易安装教程.txt)，包含下载安装、浏览器扩展配对和导入自己的 Yahoo 球队，可直接转发给朋友。

在本仓库的 [Releases](https://github.com/boringcoin/NBA-Fantasy-mini-app/releases) 下载测试包。完整 ZIP 包含安装程序、浏览器同步扩展和说明，解压后按说明安装。

- [Windows x64 测试包](https://github.com/boringcoin/NBA-Fantasy-mini-app/releases/download/v2.1.5/ThunderFantasy-2.1.5-Windows-x64.zip)
- [Mac Apple 芯片测试包](https://github.com/boringcoin/NBA-Fantasy-mini-app/releases/download/v2.1.5/ThunderFantasy-2.1.5-Mac-Apple.zip)

各平台安装文件对应如下：

| 电脑 | 安装文件 |
| --- | --- |
| Mac Apple 芯片，macOS 13+ | `ThunderFantasy-版本号-mac-arm64.dmg` |
| Windows 10/11，64 位 | `ThunderFantasy-版本号-win-x64.exe` |

同时下载浏览器扩展和说明。完整分享 ZIP 中已经附带扩展；GitHub Actions 构建产物中的扩展单列为 `ThunderFantasy-BrowserExtension-and-Docs`。

1. 安装并打开桌面应用，在“设置与配对”生成六位配对码。
2. 在“设置与配对 → 应用更新 → 同步扩展自动维护”打开应用管理目录。在 Edge / Chrome 扩展管理页开启开发人员模式，加载这个含有 `manifest.json` 的 `YahooSync` 目录，以后扩展文件可随应用维护。安装包自带的扩展也能手动加载，但不会自动维护那个目录。
3. 输入配对码，登录自己的 Yahoo，打开自己球队的 **My Team** 页面。
4. 点击浏览器扩展，核对页面球队信息，再点“导入当前球队”。应用会添加该联盟并请求首次同步。
5. 其他联盟重复第 3、4 步；之后可在桌面应用下拉菜单切换。

也可以在应用手动填写联盟 ID 和球队 ID。网页导入只针对当前打开的球队页，不会扫描账号中的所有联盟；请确认打开的是自己的球队。同一联盟换球队请在桌面设置中修改。

自动同步需要应用运行、Yahoo 保持登录并保留一个已配置联盟标签页。每 10 分钟更新当天有比赛的自有球员；手动刷新更新球员场均和全盟统计。每周自动导出未启用。

完整安装、统计口径和导出操作见 [使用说明](使用说明.md)。

## 功能

- Mac Apple 与 Windows x64 支持应用内更新：自动检查并下载，校验后点击“重启并安装”。从旧版首次升级仍需手动安装 2.1.5。
- 应用管理的同步扩展目录随应用更新维护，浏览器仅需重新加载页面；首次迁移目录需重新配对一次。
- 雷霆比分、三日赛程、实时战报、双方球员数据；窗口可调大小。
- 多联盟切换，近 14 天及本赛季场均、GP、当前比赛日统计。
- 每项按联盟人数分配排名分：12 人联盟第一 12 分、第二 11 分，并列平分所占名次。
- 全员两两对战、真实当周对局、以中位数为基准的走位、对手爆种／失常和单项险胜。
- “盟内战力 → 统计周次”可切换上周等已同步周次；历史完整数据保存在本机。交互报告也可换周，支持按所选周导出。
- 球员价值和可选自由球员参考，结合样本、位置及 Yahoo 当前伤停标记。
- 离线 HTML 报告可排序、筛选、切换背景，另可导出 Excel 和五类图表。

当前支持 Yahoo NBA 分类计分联盟，包括 9 项、11 项；不支持积分制和其他运动。统计依赖 Yahoo 页面结构与数据更新时间。

## 本地开发

在本目录使用 Node.js 24 或更新版本：

```sh
npm ci
npx install-electron
npm test
npm start
```

可用合成数据验证界面和导出，无需 Yahoo 账号：

```sh
node scripts/make-smoke-input.cjs
npm run smoke -- --data-dir .smoke/profile --input .smoke/input.json --smoke-output .smoke/result
```

在相应系统打包：

```sh
# Mac：Apple 芯片版
npm run dist:mac -- --publish never

# Windows：x64 安装程序
npm run dist:win -- --publish never
```

安装文件生成在 `release/`。`core/` 是共享分析、同步服务和导出逻辑，`app/` 是 Electron 桌面界面，`extension/` 是浏览器扩展，`test/` 仅使用合成测试数据。

## 上传到 GitHub 和构建

**将这个 `fantasy-desktop` 目录的内容作为仓库根目录**，根目录应直接看到 `package.json`、`README.md` 和 `.github/`。不要上传上一级工作目录、个人周报、浏览器配置或应用数据目录。安装包放在 Releases 附件中，不加入 Git 源码历史。

可以通过 GitHub Desktop 将本目录建立为仓库并发布。上传时保留 `.github/workflows/build.yml` 和 `package-lock.json`；`.gitignore` 已排除依赖、构建缓存、测试输出、安装包和常见凭证文件。

仓库上传后，进入 **Actions → Build Mac and Windows → Run workflow**。也可以推送与 `package.json` 版本相同的 `v版本号` 标签触发。工作流分别使用 Mac Apple 和 Windows 原生运行环境执行测试、桌面导出验证及打包。

运行成功后从该次 Actions 页面下载两个安装包产物和 `ThunderFantasy-BrowserExtension-and-Docs`。手动运行只生成构建产物。推送与 package.json 版本一致的 v版本号 标签后，工作流会在两个平台测试和构建全部成功后，自动打包包含安装程序、浏览器扩展和说明的两个 ZIP，并发布到该版本的测试版 Release，同时附上源码包与 SHA-256 校验清单。发布先创建草稿，所有附件上传并核对完整后才公开。只有发布任务临时拥有当前仓库的写权限，不需要个人 GitHub 令牌或 Yahoo 登录信息。Actions 产物保留 30 天，Releases 用于长期分发。

工作流定义参考 [GitHub Actions 工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) 与 [官方运行环境说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

## 测试版状态与隐私

Mac 包使用本地临时签名，未经过 Apple 公证；Windows 包没有发布者代码签名，系统可能提示开发者未经验证。Mac Apple 和 Windows 的实际安装、退出、真实账号同步仍需要相应电脑测试。仓库附带的工作流尚需在上传后实际运行，不能将配置文件视为云端验证通过。

扩展利用浏览器已有的 Yahoo 登录访问页面，不读取或转存密码、Cookie。提取的数据通过 `127.0.0.1:18747` 发送到本机配对的应用，不上传到 GitHub。公开源码与分发安装包不会共享使用者的账号；导出的报告则包含联盟成员和统计数据，请按需要分享。

当前源码未选定开源许可证（`UNLICENSED`）。放到公开仓库不等于授予开源使用许可；仓库所有者可以在决定许可方式后添加对应许可证。项目不隶属于 Yahoo、NBA 或雷霆队，产品名称、数据和标识分别属于其权利人。
