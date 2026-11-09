#!/bin/zsh
cd -- "$(dirname -- "$0")"
for candidate in /usr/local/bin/node /opt/homebrew/bin/node "$(command -v node)"; do
  if [[ -x "$candidate" ]] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)' 2>/dev/null; then
    export INSURANCE_NODE="$candidate"
    break
  fi
done
if [[ -z "$INSURANCE_NODE" ]]; then
  echo "请先安装 Node.js 24 或更新版本，然后重新双击此文件。"
  read -r "?按回车退出"
  exit 1
fi
"$INSURANCE_NODE" --env-file-if-exists=.env launcher.mjs
read -r "?按回车关闭窗口"
