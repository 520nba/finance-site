/** @type {import('next').NextConfig} */
const nextConfig = {
  // 禁用 HTTP keep-alive，强制每次请求新建连接（HTTP/1.1）
  // 解决 Node.js 18+ 对部分中国金融数据服务器的 HTTP/2 握手 EOF 问题
  httpAgentOptions: {
    keepAlive: false,
  },
};

export default nextConfig;
