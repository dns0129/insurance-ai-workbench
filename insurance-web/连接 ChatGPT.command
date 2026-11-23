#!/bin/zsh
cd -- "${0:A:h}"
export PATH="/usr/local/bin:$PATH"
if [[ ! -x /usr/local/bin/node ]]; then
  print -u2 '未找到 Node.js。请参考 README 的 Pi 安装与登录说明。'
  exit 1
fi
exec /usr/local/bin/node --env-file-if-exists=.env --input-type=module -e '
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const env={...process.env};
if(env.NODE_ENV==="production"){console.error("生产模式使用 DeepSeek，无需登录 ChatGPT。");process.exit(1);}
if(!process.stdin.isTTY||!process.stdout.isTTY){console.error("请在 macOS 终端中打开此文件，以使用 Pi 的登录菜单。");process.exit(1);}
if(env.PI_CODING_AGENT_DIR)env.PI_CODING_AGENT_DIR=resolve(env.PI_CODING_AGENT_DIR);
const provider=env.PI_AGENT_PROVIDER||"openai";
console.log(`Pi 打开后，输入 /login ${provider} 并按回车，再选择 Sign in with ChatGPT。`);
const args=["--tui-mode","regular","--no-session","--no-approve","--no-extensions","--no-tools","--no-mcp"];
const result=spawnSync(env.PI_AGENT_BIN||"pi",args,{stdio:"inherit",env});
if(result.error)console.error("无法启动 Pi Agent。请检查 README 的安装说明。");
process.exitCode=result.status??1;
'
