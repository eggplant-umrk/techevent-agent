// いじわる試験用：偽の API（手元だけ）。本物の API は使わない。
//   node scripts/abuse/fake_api.mjs <ポート> <モードを書いたファイル> <呼び出しの記録ファイル>
// 確認用のサーバーを ANTHROPIC_BASE_URL=http://127.0.0.1:<ポート> と、にせのキーで立てると、ここに届く。
// モード（ファイルの中身。試験の途中で書き換える）：
//   429   … 混雑（rate_limit_error）を返す      529 … 過負荷（overloaded_error）を返す
//   500   … サーバーのエラーを返す               hang … 返事をしない（時間切れ・再起動の試験）
//   badjson … 200 だが JSON でない中身を返す
import http from "node:http";
import fs from "node:fs";

const [port, modeFile, logFile] = process.argv.slice(2);
const mode = () => (fs.existsSync(modeFile) ? fs.readFileSync(modeFile, "utf-8").trim() : "429");
const err = (res, status, type, message, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", "request-id": "req_fake", ...headers });
  res.end(JSON.stringify({ type: "error", error: { type, message } }));
};
http
  .createServer((req, res) => {
    let size = 0;
    req.on("data", (c) => (size += c.length));
    req.on("end", () => {
      const m = mode();
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${m} ${req.method} ${req.url} ${size}\n`);
      if (m === "429") return err(res, 429, "rate_limit_error", "fake: rate limited", { "retry-after": "1" });
      if (m === "529") return err(res, 529, "overloaded_error", "fake: overloaded");
      if (m === "500") return err(res, 500, "api_error", "fake: internal error");
      if (m === "badjson") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end("<html>not json</html>");
      }
      // hang：返事をしない（つないだまま）
    });
  })
  .listen(Number(port), "127.0.0.1", () => console.log(`fake api on 127.0.0.1:${port}`));
