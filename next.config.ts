import type { NextConfig } from "next";
import { shareConfigProblem } from "./lib/share";

// SHARE_MODE=lan なのに合言葉（ACCESS_CODE）がないなど、起動してはいけない設定なら止める（scripts/serve.mjs を通さずに起動したときも）
const problem = shareConfigProblem();
if (problem) throw new Error(`起動しません：${problem}`);

const nextConfig: NextConfig = {};

export default nextConfig;
