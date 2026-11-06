# PC Agent

一个只在本机运行的个人助手起步项目。独立于 `Local-Ai-Project`，共用电脑上已有的 Ollama，不复制模型、不导入旧聊天、不接付费云 API。

## 这一版可以做什么

- 选择本机已安装的模型并流式聊天；优先匹配 `deepseek-r1:8b`，没有安装时不会擅自选择更大的模型。
- 对话独立保存到 `data/pc-agent.sqlite`；支持搜索标题和内容、重新打开、确认删除、导出 Markdown。
- 模型回答支持简单 Markdown、列表和代码块；HTML 只作为文字显示，不加载外部图片、不执行模型给出的代码。
- 一个简洁的电脑形象，联动待机、离线、加载、思考、回答和游戏模式。它是界面动画，不是另一个 AI 模型，也不是桌面悬浮窗。
- 查看 Ollama 是否在线、哪些模型已加载，以及 Ollama 报告的模型显存占用。不是整张 GPU 的总占用，也不是游戏帧率预测。
- 手动释放模型显存：确认后停止本应用生成，保存已收到的部分回答，再请求释放 Ollama 当前已加载模型，并重新查询确认。
- 游戏模式：在后端阻止所有本应用页面发起新生成，释放模型并将模式存入数据库。退出后不预加载；重启仍保留游戏模式。

语音识别、朗读、任务/笔记 Agent 工具、文件访问、联网搜索、自训练、自动识别游戏与桌面悬浮窗均尚未接入。界面明确显示这些边界。第一版没有给模型执行命令或直接操作数据库的权限。

## 启动

需要 Node.js（本机测试版本为 24.18，使用其内置 SQLite）和 Ollama。无需安装 npm 运行依赖。

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
