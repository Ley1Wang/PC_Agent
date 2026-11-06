module.exports = {
  appId: "local.pcagent.desktop",
  productName: "PC Agent",
  executableName: "PC-Agent",
  asar: true,
  npmRebuild: false,
  directories: { output: "release", buildResources: ".local/build-icons" },
  files: ["desktop/**", "backend/**", "frontend/**", "package.json", "README.md"],
  extraResources: [{ from: ".local/build-icons", to: "icons", filter: ["icon.png", "icon.ico"] }],
  win: {
    icon: ".local/build-icons/icon.ico",
    target: [{ target: "portable", arch: ["x64"] }, { target: "nsis", arch: ["x64"] }],
    artifactName: "PC-Agent-${version}-${arch}.${ext}",
    requestedExecutionLevel: "asInvoker"
  },
  portable: { artifactName: "PC-Agent-${version}-portable-${arch}.${ext}", requestExecutionLevel: "user" },
  nsis: {
    artifactName: "PC-Agent-${version}-Setup-${arch}.${ext}",
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "PC Agent",
    runAfterFinish: false,
    deleteAppDataOnUninstall: false
  }
};
