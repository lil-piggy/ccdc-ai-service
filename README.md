# CCDC 智能金融助手 · 全栈版

基于 CCDC（中央结算公司）品牌的 AI 智能金融分析终端，支持多用户在线使用，数据云端持久化。

## 功能特性

- 🤖 **AI 金融分析**：债券定价、信用分析、募集书解读、宏观点评、收益率曲线
- 🔐 **多用户隔离**：注册/登录系统，每个用户独立的数据空间
- 💬 **对话历史**：云端保存，跨设备同步
- 📚 **知识库 RAG**：每个用户可上传文档，AI 自动检索增强回答
- 🎨 **主题切换**：HUD 暗黑 / 明亮 / 赛博朋克 三种风格
- 🔀 **多模型对比**：同时向两个模型提问，左右对比答案
- 🎭 **角色定制**：自定义系统提示词（Persona）
- 📊 **实时市场数据**：模拟中债市场快讯面板

## 快速部署（Render.com 免费版）

### 1. 准备环境

确保已安装 Node.js 18+ 和 Git。

### 2. 克隆项目

```bash
git clone <你的仓库地址>
cd ccdc-ai-service
npm install
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env`，并填入你的 API 信息：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
PORT=3000
JWT_SECRET=随机长字符串（至少32位）
ADMIN_API_URL=https://api.moonshot.cn/v1/chat/completions
ADMIN_API_KEY=sk-your-api-key
ADMIN_API_MODEL=kimi-k2.6
ADMIN_MODEL_LABEL=Kimi K2.6
```

### 4. 本地启动

```bash
npm start
```

访问 http://localhost:3000

### 5. 部署到 Render

1. 将代码推送到 GitHub
2. 登录 [Render.com](https://render.com)，新建 **Web Service**
3. 关联 GitHub 仓库
4. 设置环境变量（参考 `.env.example`）
5. 点击 Deploy，等待自动部署完成

部署完成后，你会获得一个公网 URL（如 `https://ccdc-ai-service.onrender.com`）。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | 纯 HTML/CSS/JS（单页应用） |
| 后端 | Express.js + Node.js |
| 数据库 | SQLite（better-sqlite3） |
| 认证 | JWT（jsonwebtoken）+ bcryptjs |
| 部署 | Render.com（免费版） |

## 管理员操作

- **API 费用**：所有用户共享你在 `.env` 中配置的 `ADMIN_API_KEY`，费用由你承担
- **数据备份**：SQLite 文件位于项目根目录 `data.sqlite`，可定期备份
- **用户管理**：当前为自助注册，如需限制注册，可在 `server.js` 中添加邀请码逻辑

## 注意事项

- Render 免费版有 15 分钟无请求休眠机制，首次访问可能需要等待 10-30 秒唤醒
- 如需绑定自定义域名，在 Render Dashboard → Settings → Custom Domains 中配置
- 如需国内访问，建议绑定已备案域名 + CDN（如 Cloudflare）
