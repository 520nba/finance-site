# Windows Server 部署指南

本指南将指导您将此“自选股票/基金波动率追踪工具”部署到另一台 Windows Server 上。

## 1. 基础环境准备

在目标服务器上，您需要安装以下软件：

1.  **Node.js (LTS 版本)**：建议安装 v18 或更高版本。
    *   下载地址：[nodejs.org](https://nodejs.org/)
2.  **Git (可选)**：用于拉取代码。如果不安装，可以直接手动复制项目文件夹。

## 2. 获取代码与安装依赖

1.  将本项目文件夹（包含 `app`, `components`, `lib`, `public`, `data` 等）复制到服务器。
2.  打开服务器的 **PowerShell** 或 **CMD**，进入项目根目录。
3.  执行安装命令：
    ```powershell
    npm install
    ```

## 3. 构建项目

在正式运行前，需要先进行生产环境构建以优化性能：

```powershell
npm run build
```

## 4. 持久化运行 (建议方式)

直接运行 `npm start` 会在关闭命令行窗口时停止。建议使用 **PM2** 管理进程，使其能够开机自启并后台运行。

1.  **安装 PM2**：
    ```powershell
    npm install -g pm2
    ```
2.  **启动应用**：
    ```powershell
    pm2 start npm --name "stock-tracker" -- start
    ```
3.  **保存状态（确保自启）**：
    对于 Windows，建议配合 `pm2-windows-service` 使用，或者简单地使用 `pm2 save` 并在服务器重启后手动拉起。

## 5. 网络与防火墙配置

1.  **开放端口**：
    *   默认情况下，Next.js 运行在 **3000** 端口。
    *   您需要在 Windows 防火墙中创建“入站规则”，开放 TCP 3000 端口。
2.  **（可选）域名访问 / 80 端口**：
    *   如果您希望通过 `http://服务器IP` 直接访问（不带端口号），建议安装 **IIS** 并使用 **URL Rewrite** 模块作为反向代理。
    *   或者直接用管理员权限启动到 80 端口（不推荐项目直接监听 80）：
        ```powershell
        $env:PORT=80; pm2 start npm --name "stock-tracker" -- start
        ```

## 6. 重要注意事项

*   **数据持久化**：应用的用户列表和代码缓存存储在 `./data/` 目录下。如果在服务器上移动了目录，请确保该目录拥有读写权限。
*   **网络环境**：服务器需要能够访问互联网，以便抓取腾讯行情接口（`qt.gtimg.cn`）。

---
部署完成后，您只需访问 `http://服务器IP:3000` 即可开始使用。
