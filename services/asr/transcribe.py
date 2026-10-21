"""ASR local (Apple Silicon) com timestamps por palavra.

Uso:
  uv run --python 3.12 --with mlx-whisper services/asr/transcribe.py <audio> <saida.json> [idioma] [--limpo] [--chunks trechos.json] [--glossario "Termo, Outro termo"]

Saída: {"language", "duration", "words": [{"w","start","end","p","k"}], "segments": [{"start","end","text","k"}]}

--glossario: nomes e marcas do perfil do cliente (BL-0081), com a grafia certa. Entram no initial_prompt depois do
prompt "ao pé da letra"; sem glossário o prompt é exatamente o de antes.

--chunks: lista JSON de [início, fim] em segundos. Cada trecho de fala é transcrito SEPARADO.
Transcrevendo o arquivo inteiro, o Whisper trata várias tentativas da mesma frase como uma só e espalha
as palavras pelas tentativas — o texto deixa de bater com o áudio. Trecho a trecho, o texto de cada um é
exatamente o que foi dito nele (e "k" diz de qual trecho a palavra veio).
"""
import json
import re
import sys
import time

import mlx_whisper
from mlx_whisper.audio import SAMPLE_RATE, load_audio

MODEL = "mlx-community/whisper-large-v3-turbo"

# Modo "ao pé da letra": um prompt cheio de hesitações e repetições faz o Whisper transcrever o que
# foi DITO (gagueira, "da… da empresa", reinícios) em vez de limpar o texto. Para decupagem isso é
# essencial — repetição escondida pelo ASR vira gagueira que sobra no corte.
VERBATIM_PROMPT = "Então, é... eu, eu acho que... que, tipo, ahn, a gente, a gente vai... vai fazer, né? Hum... da, da empresa."

# Alucinações clássicas do Whisper em trecho curto/ruidoso (vêm dos dados de treino, não do áudio).
HALLUCINATION = re.compile(r"(legendas? (pela|por)|amara\.org|inscreva-se|obrigad[oa] por assistir|^\W*(obrigad[oa]|tchau)\W*$)", re.I)


# O Whisper guarda só os últimos ~223 tokens do prompt: um glossário longo empurraria o VERBATIM_PROMPT para fora.
GLOSSARIO_MAX_CHARS = 600


def glossario_trecho(glossario):
    """Termos do glossário ("A, B, C") até GLOSSARIO_MAX_CHARS, sem cortar termo no meio (os primeiros são os mais recentes)."""
    out = ""
    for termo in (t.strip() for t in glossario.split(",")):
        if not termo:
            continue
        nxt = termo if not out else out + ", " + termo
        if len(nxt) > GLOSSARIO_MAX_CHARS:
            break
        out = nxt
    return out


def initial_prompt(verbatim, glossario=None):
    """Prompt do Whisper: o "ao pé da letra" (se ligado) + os termos do glossário do cliente (se houver)."""
    parts = [VERBATIM_PROMPT] if verbatim else []
    trecho = glossario_trecho(glossario) if glossario else ""
    if trecho:
        parts.append("Nomes e marcas: " + trecho + ".")
    return " ".join(parts) or None


def transcribe(audio, lang, verbatim, glossario=None):
    return mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=MODEL,
        language=lang,
        word_timestamps=True,
        # Sem condicionar no texto anterior: em fala com retake o modelo tende a "limpar" repetições.
        condition_on_previous_text=False,
        initial_prompt=initial_prompt(verbatim, glossario),
        verbose=None,
    )


def collect(r, offset, k, words, segments, limit=None):
    for s in r["segments"]:
        text = s["text"].strip()
        if not text or HALLUCINATION.search(text):
            continue
        if s.get("no_speech_prob", 0) > 0.6 and s.get("avg_logprob", 0) < -1.0:
            continue
        text = re.sub(r"((\b\w+\b)[,.]?\s+)(\2[,.]?\s+){3,}", r"\1\1\1", text)
        segments.append({"start": round(s["start"] + offset, 3), "end": round(s["end"] + offset, 3), "text": text[:400], "k": k})
        seg_words = s.get("words", [])
        # Whisper às vezes entra em loop ("ahn, ahn, ahn…" centenas de vezes): mantém no máximo 3 repetições.
        kept_words, run = [], 0
        for w in seg_words:
            same = kept_words and w["word"].strip().lower() == kept_words[-1]["word"].strip().lower()
            run = run + 1 if same else 0
            if run < 3:
                kept_words.append(w)
        for w in kept_words:
            st, en = w["start"] + offset, w["end"] + offset
            if limit is not None:
                st, en = max(offset, min(st, limit)), max(offset, min(en, limit))
            words.append({"w": w["word"].strip(), "start": round(st, 3), "end": round(en, 3), "p": round(w.get("probability", 0), 3), "k": k})


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    glossario = sys.argv[sys.argv.index("--glossario") + 1] if "--glossario" in sys.argv else None
    args = [a for a in sys.argv[3:] if not a.startswith("--") and a != glossario]
    lang = next((a for a in args if not a.endswith(".json")), "pt")
    verbatim = "--limpo" not in sys.argv
    chunks = None
    if "--chunks" in sys.argv:
        chunks = json.load(open(sys.argv[sys.argv.index("--chunks") + 1]))
    t0 = time.time()
    words, segments = [], []
    if chunks:
        audio = load_audio(src)
        for k, (a, b) in enumerate(chunks):
            piece = audio[int(a * SAMPLE_RATE) : int(b * SAMPLE_RATE)]
            if len(piece) < SAMPLE_RATE * 0.1:
                continue
            collect(transcribe(piece, lang, verbatim, glossario), a, k, words, segments, limit=b)
        duration = len(audio) / SAMPLE_RATE
    else:
        collect(transcribe(src, lang, verbatim, glossario), 0.0, 0, words, segments)
        duration = segments[-1]["end"] if segments else 0
    json.dump(
        {"language": lang, "duration": duration, "model": MODEL, "verbatim": verbatim, **({"glossario": glossario} if glossario else {}), "chunked": bool(chunks), "elapsed": round(time.time() - t0, 2), "words": words, "segments": segments},
        open(out, "w"),
        ensure_ascii=False,
    )
    print(json.dumps({"ok": True, "words": len(words), "chunks": len(chunks or []), "elapsed": round(time.time() - t0, 2)}))


if __name__ == "__main__":
    main()
