import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { api } from "./routes.mjs";
import { syncChannels } from "./im/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/api", api);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "..", "dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));
  }
}

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`[xiaowen-budget] API listening on http://localhost:${PORT}`);
  // 启动已启用的 IM 渠道（Telegram 长轮询等）
  syncChannels();
});
