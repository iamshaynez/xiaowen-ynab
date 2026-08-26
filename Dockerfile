# syntax=docker/dockerfile:1
# 多阶段构建：builder 编译前端(tsc + vite)，runtime 仅带运行时依赖。
#
# 运行环境变量：
#   DATA_DIR=/data    —— SQLite 数据库位置（默认挂载卷）
#   APP_PASSWORD      —— 可选，设置后启用密码登录
#   JWT_SECRET        —— 可选，JWT 签名密钥（不设置时由密码派生）
#   PORT=3001         —— 服务监听端口

FROM node:20-slim AS build
WORKDIR /app
# 构建工具：若 better-sqlite3 无预编译二进制，则按需从源码编译
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
# 确保数据库目录存在且归 node 用户所有（配合命名卷持久化）
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3001
VOLUME ["/data"]
CMD ["node", "server/index.mjs"]
