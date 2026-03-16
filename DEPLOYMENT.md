# Cloudflare Workers 部署指南

本项目基于 **Next.js (App Router)** 并通过 **@opennextjs/cloudflare** 部署在 Cloudflare Workers 边缘运行时。

## 1. 基础环境准备

1.  **Node.js (LTS)**：推荐使用 v20 或更高版本。
2.  **Cloudflare 账户**：需要一个活跃的 Cloudflare 账户并开通 D1 数据库功能。

## 2. 获取代码与安装依赖

```powershell
git clone <repository-url>
cd stock-tracker
npm install
```

## 3. 环境变量配置

在项目根目录创建 `.dev.vars` (本地开发) 并确保 Cloudflare 控制台已配置以下环境变量：

- `ADMIN_API_KEY`: 管理员 API 访问密钥 (PSK)。
- `NEXT_PUBLIC_SITE_URL`: 网站访问地址。

## 4. 数据库初始化 (D1)

1.  **创建数据库**：
    ```powershell
    npx wrangler d1 create stock-tracker-db
    ```
2.  **更新配置文件**：将输出中的 `database_id` 填入 `wrangler.toml` 的 `[[d1_databases]]` 部分。
3.  **应用迁移**：
    ```powershell
    # 本地预览环境
    npx wrangler d1 migrations apply stock-tracker-db --local
    # 生产环境
    npx wrangler d1 migrations apply stock-tracker-db --remote
    ```

## 5. 本地开发与预览

- **开发模式**：`npm run dev`
- **边缘模拟预览**：`npm run preview` (使用 Miniflare 模拟实时环境)

## 6. 构建与部署

```powershell
# 执行 OpenNext 构建并推送到 Cloudflare
npm run deploy
```

## 7. 重要注意事项

- **离线任务 (Crons)**：部署后，Cloudflare 会根据 `wrangler.toml` 中的 `[triggers.crons]` 自动运行同步任务。
- **存储配额**：请关注 D1 的读写限制（免费额度通常足够中小型每日使用）。
- **缓存说明**：应用使用了 `memoryCache.js` 进行 L1 缓存，但在多实例环境下可能存在短暂不一致。
