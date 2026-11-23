# 保顾智库 · 保险团队 AI 中台

保留黑白圆体与红色预警的可操作网页版。当前仅保留 3 位代理人：苏晴（A001）、许佳（A003）、林晓（A006），以及他们名下的客户与 2026 年 5–10 月保单。已对原 200 人数据库做完整备份，位于 data/backups/。

## 启动

macOS 双击 `启动工作台.command`，访问 http://localhost:4387 。也可用 Node.js 24 或更新版本运行：

```sh
cd insurance-web
npm start
```

核心工作台无需安装第三方 npm 依赖。知识库上传需要 Python 和 pypdf，开发环境生成回答需要 Pi Agent（见下文）。首次运行自动生成 `data/insurance.sqlite`；后续启动复用数据，录入的保单不会随刷新或重启丢失。

当前 Mac 的 Homebrew Node 不可用，双击入口会优先使用已验证可用的 `/usr/local/bin/node`。命令行也可以运行 `/usr/local/bin/node --env-file-if-exists=.env server.mjs`。

## 操作

左侧导航分别进入经营总览、保单明细、AI 经营助理；代理人另有客户档案页。走势图包含月目标虚线，并可展开每月精确数值表。

- 团队长：登录页选择团队长；搜索姓名或编号，按达标/预警筛选，使用三张成员卡片并列展示。点击成员联动走势和保单；“查看全团队走势”恢复汇总。
- 切换 2026 年 5–10 月，查看截至该月的历史走势；重点注意区显示达成率低于 60% 的成员，点击按钮筛选全部预警人员。
- 录入保单：选择代理人及其名下客户，填写唯一保单号、险种、开单日期、首年保费。保存后自动切换到对应月份和成员，并刷新金额、差额、件数、走势。
- 代理人：切换演示账号后任选一个代理人（默认林晓 A006），只返回自己的业绩、保单、客户和画像。
- AI：选择分析主题或直接提问。未配置服务时明确标注“模拟分析”；真实服务异常会显示错误，不会用模拟结果冒充真实 AI。

## 员工个人进度

在登录页选「代理人」，可选「林晓 · 兼职演示 · A006」或「苏晴 · 全职演示 · A001」。登录后直接进入「我的进度」，也可从左侧「个人进度」返回。切换示例身份请用右上角「切换账号」。

- **业绩与目标**：沿用现有保单账本和目标，按所选月份汇总，人民币首年保费与目标口径不变。
- **佣金与活动**：两账号各有 2026 年 10 月的虚构港币佣金，可展开已结算和待核对明细；其他月份无佣金样例。示例活动可按团队或公司筛选并查看详情，不提供实际报名。
- 个人数据由服务端按当前演示会话读取。选用哪个账号是演示入口的功能；这里没有正式员工认证或结算系统。

## 投保资料预检

登录后从左侧进入「投保资料预检」。内置「虚构医疗保障」和「虚构家庭保障」两份清单。

- **团队长**：选择样例，维护条目名称、核对说明及必备状态。保存新版本后，代理人下次进入页面会读取最新清单。清单存放在本地 SQLite，服务重启后保留。
- **代理人**：可逐项勾选或点击「加载示例勾选」，即时查看缺少的必备项。核对后勾选人工确认，即可下载 TXT，内容包括清单版本、确认人、时间及各项状态。缺项会保留在记录中；修改勾选或换清单后需重新确认。
- 服务端限制团队长修改、代理人确认导出。若清单已更新，旧版不会导出，页面会读取新版并清除本次勾选与确认。

只演示准备材料，不采集客户信息、不作核保决定，也不向外部提交。勾选状态只在当前页面会话保留。接口回归由 `npm test` 执行；浏览器验证可运行 `python test/precheck_ui.py`，需要 Playwright 和 Chromium。

## 团队 AI 助理与知识库

从左侧「团队 AI 助理」进入。团队长另可进入「团队知识库」。

- **保险异议处理**：输入客户原话，可加产品、沟通阶段和匿名背景；助手整理顾虑、参考话术、下一步核对和追问。
- **保险新人助手**：用团队制度和手册回答带教、系统使用、晋升及佣金核对。答案附 PDF 页码和片段，资料不足时提示找谁或核对什么。
- **产品知识助手**：按产品资料回答条款要点和需求沟通方向，可查看、下载引用的原始 PDF。
- **团队知识库**：团队长可多选或拖入 PDF、分类、试查文字片段、查看、停用和移除；代理人只访问启用的团队资料。分类决定哪个助手可用，停用从下一次检索起生效。原件、从 PDF 按页提取的文字及全文索引同存 SQLite，刷新、切换设备和重启服务后保留。单件 15 MB、250 页；扫描件先 OCR，旧版演示曾存进浏览器的文件需重新上传。
- 会话内容不写入 SQLite。开发样例明确标识，匹配到正式文件时优先使用正式资料；生产不检索或显示内置样例。请勿在提问里填姓名、证件号、保单编号或病史。模型收到问题与有限的已授权资料片段。

RAG 使用 SQLite FTS5 全文检索和中文分词，对应来源可回到文件页码；当前工作台以一个 SQLite 文件服务一个团队。开发与生产共用 `knowledge/assistant.mjs` 的提示词、资料范围、检索和引用验证，只更换 `knowledge/providers.mjs` 的模型调用。未命中资料时直接返回资料不足；模型不可用时给出提示。

### 开发：Pi Agent 调用 ChatGPT

在 `insurance-web` 目录完成这两项设置，然后重启工作台：

1. 安装 PDF 提取依赖：`python3 -m venv .venv-knowledge` 和 `.venv-knowledge/bin/python -m pip install -r requirements.txt`；在 `.env` 设 `KNOWLEDGE_PYTHON=.venv-knowledge/bin/python`。已经装好 pypdf 的开发机可使用默认 `python3`。
2. 按 [Pi 官方安装说明](https://docs.pi.dev/latest/quickstart) 安装 Pi 1.5 或更新版本，在 Pi 中执行 `/login openai`，选择「Sign in with ChatGPT」。服务器默认从 PATH 找 `pi`。可以在 `.env` 设置 `PI_AGENT_BIN`、`PI_AGENT_MODEL`（默认 `gpt-6.1-sol`）和 `PI_CODING_AGENT_DIR`。若改用其他模型，请选择当前 ChatGPT 账号授权可用的模型。登录与启动工作台须指向同一个 Pi 配置目录。

macOS 可双击「连接 ChatGPT.command」打开 Pi，也可以在当前目录运行下面第一行。Pi 打开后输入 `/login openai`，按回车并选择「Sign in with ChatGPT」。完成授权后按 `Ctrl+D` 退出 Pi，再运行第二行验证模型。

```sh
./连接\ ChatGPT.command
/usr/local/bin/node --env-file-if-exists=.env scripts/smoke-team-ai.mjs
```

第二条仅用内置示例问题和示例资料冒烟测试，不发送现有工作台资料。开发服务默认绑定回环地址，演示账号不用于正式团队。

### 生产：DeepSeek

在生产环境通过服务管理器或私有环境文件配置以下变量。PDF 提取依赖仍需安装。使用 HTTPS 反向代理，并将服务绑定回环地址或部署平台的私有容器网络；代理需允许 15 MB 文件与 60 秒响应时间。

```dotenv
NODE_ENV=production
HOST=127.0.0.1
WORKBENCH_PUBLIC_ORIGIN=https://team.example.com
WORKBENCH_ACCOUNTS_FILE=/private-config/workbench-accounts.json
WORKBENCH_DB_PATH=/persistent/insurance.sqlite
KNOWLEDGE_PYTHON=/opt/insurance/.venv-knowledge/bin/python
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_API_KEY=
```

- 账号文件为 JSON 数组。团队长记录字段为 `username`、`role: "leader"` 和 `passwordHash`；代理人还应设 `role: "agent"` 与已存在的 `agent_id`。为每个账号独立生成 14 字符或更长的密码，将密码管理器中的值通过标准输入交给 `node scripts/hash-workbench-password.mjs`，把输出哈希写到账号文件。账号文件和密钥单独保管，勿提交 Git。修改账号配置后重启服务；主动撤销已有会话时须从数据库删除其生产会话。
- 使用 `npm start` 启动；未配置 HTTPS 来源或正式账号时生产模式会拒绝启动。上线时保留已有数据库并启用备份，另行导入获授权的团队资料。旧工作台预置的业绩和活动样例不等于正式业务数据。
- `NODE_ENV=production node --env-file-if-exists=.env scripts/smoke-team-ai.mjs` 可用虚构资料测试 [DeepSeek API](https://api-docs.deepseek.com/api/create-chat-completion/)；这条命令不会修改数据库。生产模型不会回退到 Pi。

后端回归：`npm test`。浏览器回归：`python test/assistants_ui.py`（Playwright 和 Chromium；可用 `CHROMIUM_PATH` 指定浏览器）。测试以合成模型响应验证真实上传、检索、页码与权限。

## 填写经营分析 AI 配置

已准备空白配置文件 `.env`，填写并重启服务（`.env.example` 为模板）：

```dotenv
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=在此填写密钥
AI_MODEL=在此填写模型名称
```

`AI_BASE_URL` 填服务根地址，后端会拼接 `/chat/completions`。适用于兼容 Chat Completions 协议的服务。如果你的智能体采用其他接口协议，修改 `ai.mjs` 的 `analyze()` 即可，网页不需要改动。

前端调用 `POST /api/ai/analyze`，只提交 `question`、`month`。后端从会话重新构造授权范围内的统计上下文，忽略客户端伪造的角色、人员和数据。密钥只在后端读取，`.env` 已被 Git 忽略。请求超时为 25 秒。

## 数据与权限

- 金额使用人民币；统计已生效保单的首年保费，不等同于佣金或 FYC。数据库以整数分存储。
- 所有业绩、开单数、历史走势从同一份保单账本汇总。月度目标默认每人 100,000 元。
- 团队重点预警阈值低于 60%；个人达成不足 100% 时标红。团队缺口以总业绩抵扣总目标，与每位成员缺口加总不同。
- 客户来源、年龄和性别来自该账号名下客户档案；险种分布来自所选月份保单。留存率为模拟快照：近 12 个月到期客户中完成续保的比例，不随历史月份回溯。
- 开发环境允许主动选择任意演示身份；生产环境只允许已配置的账号密码登录。进入会话后，业务、资料与 AI 接口均执行服务端角色限制。
- 服务默认仅监听 `127.0.0.1`。正式使用前按上文配置 HTTPS、员工账号、生产数据库和模型；当前未发布到公网。

## 文件

- `server.mjs`：HTTP 接口、会话、静态页面服务。
- `db.mjs`：SQLite、确定性模拟数据、账本汇总和录入校验。
- `ai.mjs`：AI 适配器与模拟分析。
- `public/`：页面、样式、交互、资源圆体字体及许可。
- `public/assistants.js`、`public/assistants.css`：三个团队助手和知识库管理的前端模块。
- `public/demo/`：带明确演示标识的示例 PDF。
- `test/integration.test.mjs`：接口、越权、账本、输入校验、AI 范围测试。

运行检查：`npm test`，或 `/usr/local/bin/node --test test/*.test.mjs`。测试使用临时数据库，不修改演示库。
