import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";

env.allowLocalModels = false;
env.useBrowserCache = true;

function makeGenerator(device: "webgpu" | "wasm") {
  return pipeline("text-generation", MODEL_ID, {
    device,
    dtype: "q4",
    progress_callback: (progress) => {
      if (progress.status === "progress" && typeof progress.progress === "number") {
        self.postMessage({
          type: "progress",
          message: `首次加载本地 AI 模型 ${Math.round(progress.progress)}%…`,
        });
      }
    },
  });
}

let generatorPromise: ReturnType<typeof makeGenerator> | null = null;

async function getGenerator() {
  if (!generatorPromise) {
    self.postMessage({ type: "progress", message: "正在准备本地 AI 模型，首次使用需要下载…" });
    const hasWebGpu = "gpu" in self.navigator;
    generatorPromise = makeGenerator(hasWebGpu ? "webgpu" : "wasm").catch(() => makeGenerator("wasm"));
  }
  return generatorPromise;
}

self.onmessage = async (event: MessageEvent<{ payload: unknown }>) => {
  try {
    const generator = await getGenerator();
    self.postMessage({ type: "progress", message: "本地 AI 正在生成财务解读…" });

    const prompt = [
      "<|im_start|>system",
      "你是谨慎的个人现金流分析助手。只基于给定的聚合流水指标回答，不推断总资产、负债、信用、投资能力或收入稳定性；不要承诺收益，不提供借贷或投资推荐。用简洁中文输出严格 JSON，不要使用 Markdown。",
      "<|im_end|>",
      "<|im_start|>user",
      `请分析以下聚合数据：${JSON.stringify(event.data.payload)}。返回格式：{"summary":"80字内总体判断并说明边界","insights":["2到4条有数字依据的发现"],"actions":["2到4条本月可执行建议"]}。建议必须能从数据中推出；数据期不足时明确说不足。`,
      "<|im_end|>",
      "<|im_start|>assistant",
    ].join("\n");

    const output = await generator(prompt, {
      max_new_tokens: 320,
      do_sample: false,
      return_full_text: false,
    });
    const first = Array.isArray(output) ? output[0] : output;
    const generatedText = first && "generated_text" in first ? first.generated_text : "";
    if (typeof generatedText !== "string" || !generatedText.trim()) {
      throw new Error("本地 AI 未生成有效内容");
    }
    self.postMessage({ type: "result", text: generatedText });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "本地 AI 运行失败",
    });
  }
};
