"""LLM local (Apple Silicon, MLX) para o NewEditor.AI — ADR-003 camada 3 / ADR-007 I-9.

Processo persistente: carrega o modelo UMA vez e responde pedidos em JSON, uma linha por pedido (stdin → stdout).

  uv run --python 3.12 --with mlx-lm services/llm/serve.py [modelo]

Pedido:  {"id": "...", "system": "...", "user": "...", "max_tokens": 400, "json": true}
Resposta: {"id": "...", "text": "...", "ms": 812}  |  {"id": "...", "error": "..."}

Sem "pensamento" (enable_thinking=False): para escolha de tomada, palavra-chave e pedido de edição, a resposta
curta e estruturada vale mais que o raciocínio longo.
"""
import json
import sys
import time

from mlx_lm import generate, load

MODEL = sys.argv[1] if len(sys.argv) > 1 else "mlx-community/Qwen3-8B-4bit"

model, tok = load(MODEL)
print(json.dumps({"ready": True, "model": MODEL}), flush=True)


def ask(req):
    msgs = []
    if req.get("system"):
        msgs.append({"role": "system", "content": req["system"]})
    user = req.get("user", "")
    if req.get("json"):
        user += "\n\nResponda SOMENTE com JSON válido, sem comentários nem texto fora do JSON."
    msgs.append({"role": "user", "content": user})
    prompt = tok.apply_chat_template(msgs, add_generation_prompt=True, enable_thinking=False)
    t0 = time.time()
    text = generate(model, tok, prompt=prompt, max_tokens=int(req.get("max_tokens", 400)), verbose=False)
    # Alguns modelos ainda abrem <think>: tira.
    if "<think>" in text:
        text = text.split("</think>")[-1]
    return {"id": req.get("id"), "text": text.strip(), "ms": int((time.time() - t0) * 1000)}


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        out = ask(req)
    except Exception as e:  # noqa: BLE001
        out = {"id": None, "error": str(e)}
        try:
            out["id"] = json.loads(line).get("id")
        except Exception:  # noqa: BLE001
            pass
    print(json.dumps(out, ensure_ascii=False), flush=True)
