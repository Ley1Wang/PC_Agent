# PC Agent

一个只在本机运行的个人助手起步项目。独立于 `Local-Ai-Project`，共用电脑上已有的 Ollama，不复制模型、不导入旧聊天、不接付费云 API。

## Windows EXE 桌面版

常用的免安装 EXE 直接放在项目文件夹：**`PC-Agent.exe`**。双击即可，不需要先手动打开 Ollama。

带版本号的打包结果仍保留在 `release/`：

- `PC-Agent-0.1.3-portable-x64.exe`：免安装，与根目录的 `PC-Agent.exe` 相同。
- `PC-Agent-0.1.3-Setup-x64.exe`：安装版，可选择目录并创建桌面/开始菜单快捷方式。无需管理员权限。

桌面版自带界面和 Node 运行环境，使用它不需要另装 Node、运行命令或打开浏览器。Ollama 和模型仍需事先安装/下载；不包含模型权重，不会自动下载或预加载模型。

启动 EXE 后会先检查本机 Ollama，已运行就直接复用；未运行则查找 Windows 默认安装目录和绝对 PATH 目录中的 `ollama.exe`，隐藏窗口执行 `ollama serve`。只绑定 `127.0.0.1:11434` 并对该子进程设置 `OLLAMA_NO_CLOUD=1`，保留现有 `OLLAMA_MODELS` 路径，不修改系统环境或开机启动项。界面会显示启动状态，缺少安装或失败时可点击「重试后台启动」。

退出 PC Agent 不强制关闭已有或新启动的共享 Ollama 后台服务；这与 Ollama 的常驻后台使用方式一致。模型仍按 60 秒驻留策略或游戏模式释放，后台服务本身不等于模型始终占显存。游戏模式下也可以启动服务，但不能加载或生成模型回答。网页版仍需手动启动 Ollama。

桌面数据保存在 `%APPDATA%\PC-Agent\data\pc-agent.sqlite`，界面草稿和模型选择保存在同一应用配置目录。更新或替换 EXE 不会覆盖这些记录；免安装版与安装版共用该目录，因此“免安装”不意味着数据会跟着 EXE 移动。菜单「文件 → 打开数据目录」可查看位置。网页版的 `data/` 不会被自动迁移或覆盖。

关闭窗口会停止本应用并关闭 SQLite；生成中的回答会先保存已经收到的内容。共享 Ollama 中的模型不因退出而被删除或强制释放，游戏前可在界面中主动释放。

桌面窗口保持页面隔离，页面没有 Node 或系统命令权限；仅连接自己的本机服务。桌面交互仅限经来源校验的文本复制和人物窗口控制，不开放剪贴板读取、文件或通用命令接口。人物窗只读取自身的静态素材和助手的状态，不请求聊天或模型接口。桌面服务使用独立的随机 HTTP-only 会话标识，普通浏览器不能直接读取它的聊天记录。默认固定本地端口为 8792，与网页版的 8790 分开；重复打开会聚焦已有窗口。

此个人测试版本没有数字签名，Windows 可能提示未知发布者。请仅运行自己构建或来源已确认的文件；正式对外分发前应完成代码签名。

## 这一版可以做什么

- 选择本机已安装的模型并流式聊天；优先匹配 `deepseek-r1:8b`，没有安装时不会擅自选择更大的模型。
- 对话独立保存到 `data/pc-agent.sqlite`；支持搜索标题和内容、重新打开、确认删除、导出 Markdown。
- 模型回答支持简单 Markdown、列表和代码块；HTML 只作为文字显示，不加载外部图片、不执行模型给出的代码。
- 桌边伙伴是 DeepSeek「鲸鱼娘」社区同人形象。待机与回答时微笑，启动、加载或思考时专注，离线和游戏模式时休息。图片随应用离线打包，不加载额外模型；桌面快捷方式继续使用电脑图标。
- 桌面版点击右侧「人物弹窗 ↗」（或「视图 → 打开人物弹窗」）可打开可拖动的小窗，最小化主窗口仍可看到人物。点「置顶」切换，游戏模式会暂停置顶；点击「×」或按 Esc 只关闭人物窗，退出 PC Agent 则一起关闭。
- 查看 Ollama 是否在线、哪些模型已加载，以及 Ollama 报告的模型显存占用。不是整张 GPU 的总占用，也不是游戏帧率预测。
- 手动释放模型显存：确认后停止本应用生成，保存已收到的部分回答，再请求释放 Ollama 当前已加载模型，并重新查询确认。
- 游戏模式：在后端阻止所有本应用页面发起新生成，释放模型并将模式存入数据库。退出后不预加载；重启仍保留游戏模式。

语音识别、朗读、任务/笔记 Agent 工具、文件访问、联网搜索、自训练与自动识别游戏均尚未接入。界面明确显示这些边界。第一版没有给模型执行命令或直接操作数据库的权限。

鲸鱼娘表情取自 [Small-tailqwq 的深海女仆工坊](https://github.com/Small-tailqwq/dsh-deep-whale/tree/e74fa8439b8584ed16113920894491b5e0e1e4a0/maid-atelier/assets/icons)，原角色由上善无形设计、DeepSeek 主题版本由 ZipZipPipe 重设计，表情素材由 Small-tailqwq 制作。三张原图未经修改；完整[署名](frontend/assets/whale/NOTICE)和[美术许可](frontend/assets/whale/LICENSE-ARTWORK)随程序附带。CC BY-NC-SA 4.0 仅适用于这组美术素材（非商业使用），与 DeepSeek 官方无隶属关系。

## 启动

以下是源码/网页版的启动方式，需要 Node.js（本机测试版本为 24.18，使用其内置 SQLite）和 Ollama。网页后端无需 npm 运行依赖；EXE 构建依赖仅用于开发打包。

1. 打开 Ollama。
2. 如需 DeepSeek，在终端手动运行 `ollama pull deepseek-r1:8b`。首次下载需要联网；本项目不会自动下载或加载模型。
3. 双击 `start-pc-agent.cmd`，或在此目录运行 `npm start`。
4. 服务准备好后自动打开 <http://127.0.0.1:8790>。

只启动服务、不自动打开浏览器：`node scripts/start.mjs --no-open`。

下载完成后，聊天功能不依赖外部网络。后端仅接受本机访问，Ollama 连接地址也只允许 loopback。拒绝已知云端模型标记和 `/api/show` 返回的远程模型信息，不执行网络回退。为防止其他软件使用 Ollama 云功能，可另外按 [Ollama 官方说明](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features)设置 `OLLAMA_NO_CLOUD=1` 并重启 Ollama；本项目不会更改全局环境或其他软件配置。

## 资源和游戏模式

- 每次只执行一个聊天请求，上下文 4,096 tokens，单轮生成最多 2,048 tokens；只有 `/api/show` 的 `thinking.values` 明确允许 `false` 时才请求关闭 thinking，其余模型保留默认行为。模型与 Ollama 版本会影响响应速度。
- 回答后驻留 60 秒，便于连续提问。游戏前可显式释放，释放后下一次回答需要重新加载。
- 释放是 `keep_alive: 0`，不是删除硬盘模型。相关 API：[聊天](https://docs.ollama.com/api/chat)、[运行模型状态](https://docs.ollama.com/api/ps)、[显存释放说明](https://docs.ollama.com/faq#how-do-i-keep-a-model-loaded-in-memory-or-make-it-unload-immediately)。
- 释放会作用于同一个 Ollama 中当前已加载的所有模型，可能影响旧 AI App 或其他软件；每次执行前都要求确认，并显示检测到的模型。
- 游戏模式只约束本应用。其他软件仍然可能加载模型，所以不能保证整台电脑的 GPU 完全空闲或游戏零影响。
- Ollama 离线或仍报告模型加载时，界面会显示“无法确认/尚未全部释放”，不会假称显存已经释放。
- “停止生成”保存已收到的部分回答，但不等同于释放模型显存。关闭服务也不自动释放共享 Ollama 中的其他模型。

## 数据与隐私

`data/`、`.local/`、数据库文件和环境文件均被 Git 忽略。聊天库是本地明文 SQLite，不是加密保险箱；不要保存密码或 API 密钥。备份时先关闭本应用，再复制整个 `data/` 目录。

本项目没有登录或远程访问认证，不要改成公网或局域网监听，也不要用反向代理公开它。

## 测试

```powershell
npm test
```

测试启动模拟 Ollama 和项目内 `.local/tests/` 的独立临时数据库，不读取正式 `data/`、不启动真实模型、不下载权重。覆盖分段 UTF-8、流式中断、停止保存、模型隔离、搜索、游戏模式的跨页面阻断和重启持久化，以及释放失败的诚实反馈。

```powershell
npm run preview
```

打开 <http://127.0.0.1:8791>。这是明确标注的模拟测试预览，不是真实 DeepSeek 回答；Ctrl+C 停止。预览数据在 `.local/preview/`，测试截图在 `.local/qa/`，不会再堆到 `D:/Github/tmp`。

可选浏览器测试：开发环境安装 Playwright 并准备 Chromium/Edge 后运行 `npm run test:ui`。也可通过 `PLAYWRIGHT_MODULE` 指向已有 Playwright 模块，无需改变项目依赖。真实 DeepSeek 的解题质量、工具调用能力、GPU 占用和游戏影响需要后续在真实模型上单独验证。

## 重建 EXE

```powershell
npm ci
npm run build:win
```

首次构建需要联网下载 Electron 和打包工具，不下载 AI 模型。图标从已有 `frontend/icon.svg` 转换；构建完成后会将免安装版原子替换到根目录 `PC-Agent.exe`，带版本号文件保留在被 Git 忽略的 `release/` 中，不包含聊天数据库、测试数据、`.git` 或开发依赖。若旧 EXE 正在运行导致替换失败，关闭旧版后运行 `node scripts/place-exe.mjs` 即可。

`npm test` 同时覆盖启动检测、已有服务复用、隐藏子进程参数、并发去重、启动失败、找不到安装、重试和模型路径保留。可选真实启动验证为 `node scripts/check-ollama-start.mjs`：在独立本机端口启动已安装的 Ollama，只查询版本和已加载列表，确认没有模型加载后，仅关闭本次测试创建的子进程，不影响常用端口服务。

源码桌面调试：`npm run desktop`。可选打包验证：构建完成后设置好 Playwright 环境，运行 `npm run test:desktop`。验证使用 `.local/desktop-qa/` 的隔离配置和模拟 Ollama，不读取正式桌面或网页版记录，也不安装应用。它检查实际打包程序的 SQLite、聊天、复制/导出、游戏模式、重启持久化和单实例行为，并验证免安装 EXE 可以自行解包启动。
