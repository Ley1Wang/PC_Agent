export const companionStates = Object.freeze({
  idle: ["安静待命", "形象只做状态联动，不额外加载 AI 模型。"],
  game: ["游戏模式 · 休息中", "本应用不会加载模型。其他软件的 Ollama 请求不受此开关控制。"],
  offline: ["等待 Ollama", "可以先写草稿、查看旧记录。打开 Ollama 后再发送。"],
  service: ["正在启动 Ollama", "只启动后台服务，不下载或加载模型。草稿和本地记录仍然可用。"],
  loading: ["正在加载本地模型", "首次回答可能需要等待，可随时停止。"],
  thinking: ["正在思考", "只显示状态，不展示或保存模型的独立思考字段。"],
  writing: ["正在回答", "文字流式返回中，尚未接入语音朗读。"]
});
