#!/usr/bin/env python3
# Cópia da NewStudios do _SISTEMA/bin/registro.py do Cérebro do Editor (27/10/2026, força-tarefa R4), instalada pelo
# Editor Brain em "Cérebro do Editor/NewStudios/_SISTEMA/bin/". Diferenças: sem o mapa TITULOS e sem a regra
# "linha <= 93 não é do Thales" (são do jsonl da raiz), e equity-sales → Leandro Arruda. Rodar na pasta NewStudios.
"""Gera as notas de Alterações e as Lições Técnicas do Registro de Decisões
a partir de _SISTEMA/correcoes.jsonl (fonte de verdade).

Uso (na raiz do Cérebro do Editor):
    python3 _SISTEMA/bin/registro.py

O que faz:
  - correção que veio do Thales  -> Registro de Decisões/Alterações/A-NN <titulo>.md
  - erro técnico achado por mim  -> Registro de Decisões/Lições Técnicas.md (tabela)
  - atualiza a lista de Alterações dentro de Registro de Decisões.md e de cada
    nota de cliente (entre os marcadores <!-- alteracoes:inicio --> / fim)

Para uma correção nova entrar com título bom, grave no JSON:
    "origem": "Thales", "titulo": "frase curta"
Sem "titulo", o script usa o começo da correção.
Rodar de novo é seguro: as notas A-NN são reescritas a partir do jsonl
(edição manual feita dentro delas se perde — escreva observações nas notas de cliente).
"""
import json, os, re, sys

ROOT = os.getcwd()
if not os.path.isdir(os.path.join(ROOT, "_SISTEMA")):
    sys.exit("rode na raiz do Cérebro do Editor")
REG = os.path.join(ROOT, "Registro de Decisões")
ALT = os.path.join(REG, "Alterações")
CLI = os.path.join(ROOT, "Clientes")  # na pasta NewStudios não há notas de cliente: a lista fica no índice
os.makedirs(ALT, exist_ok=True)

# linha do jsonl (1-based) -> título curto. Só as correções que vieram do Thales.
TITULOS = {}  # mapa histórico das linhas do cofre do Thales: não vale para o jsonl da NewStudios

# slug do projeto -> nota de cliente
def cliente_de(slug):
    s = slug or ""
    if s.startswith("daniel-sun"): return "Daniel Sun"
    if s.startswith(("leandro", "equity-sales")): return "Leandro Arruda"
    if s.startswith(("davi-lo", "leo-teste")): return "Davi Lo"
    if s.startswith(("guilherme-alvares", "henrico")): return "Guilherme Álvares (Avend)"
    if s.startswith(("brainer", "brane")): return "Brainer"
    if s.startswith(("murilo", "finaclub", "vlogcast")): return "Finamob (Murilo Marchesini)"
    if s.startswith(("thales", "pope")): return "Thales Rios (canal)"
    if s.startswith("gabriel-lopes"): return "Gabriel Lopes"
    if s.startswith("joao-pedro"): return "João Pedro (VD Marketing)"
    if s.startswith("ara-"): return "ARA"
    if s.startswith(("leandro", "equity-sales")): return "Leandro Arruda"
    return None

def pasta_de(slug):
    """onde o projeto mora hoje: montagens/ (em andamento) ou Registro de Decisões/<status>/ (fechado)"""
    if not slug: return "—"
    for base in ("montagens", os.path.join("Registro de Decisões", "Aprovados"),
                 os.path.join("Registro de Decisões", "Alterações"), os.path.join("Registro de Decisões", "Recusados")):
        if os.path.isdir(os.path.join(ROOT, base, slug)):
            return f"[[{base}/{slug}/ARQUIVOS|{slug}]]"
    return f"`{slug}` (pasta não existe mais)"

K_ANTES = ["ORIGINAL_DECISION", "decisao_original", "DECISAO_ORIGINAL", "ORIGINAL", "original",
           "decisao_minha", "decisao_errada", "decisao", "erro", "ERRO"]
K_PEDIDO = ["USER_CORRECTION", "correcao_do_usuario", "CORRECTION", "corrigido", "decisao_corrigida",
            "correcao", "CORRECAO"]
K_CONTEXTO = ["CONTEXT", "context", "CONDICAO", "condicao", "PECA"]
K_MOTIVO = ["REASON", "motivo"]
K_RESULTADO = ["RESULT", "resultado", "risco"]
K_REGRA = ["NEW_PATTERN", "PATTERN", "learning"]
K_NIVEL = ["CONFIDENCE", "nivel", "level", "NIVEL"]
K_ANTERIOR = ["PREVIOUS_PATTERN"]
META = {"data", "projeto", "skill", "agente", "origem", "titulo"}

def pega(d, ks, usados):
    for k in ks:
        if k in d and str(d[k]).strip():
            usados.add(k)
            return str(d[k]).strip()
    return ""

def do_thales(i, d):
    if str(d.get("origem", "")).lower().startswith("thales"): return True
    for k in ("USER_CORRECTION", "correcao_do_usuario", "CORRECTION"):
        v = str(d.get(k, "")).strip().lower()
        if v and not v.startswith(("nenhuma", "(qc", "(autocorre")):
            return True
    return False

def limpa_nome(t):
    t = re.sub(r'[\\/:*?"<>|#^\[\]]', "-", t)
    return re.sub(r"\s+", " ", t).strip()[:90]

def q(t):  # citação em bloco
    return "\n".join("> " + l for l in t.splitlines()) if t else "> —"

linhas = [l for l in open(os.path.join(ROOT, "_SISTEMA", "correcoes.jsonl"), encoding="utf-8")]
alts, tecnicas = [], []
for i, l in enumerate(linhas, 1):
    l = l.strip()
    if not l: continue
    d = json.loads(l)
    # Revisor (Igor, Vera): "origem": "revisor (<nome>)". Nunca conta como Thales e não é lição técnica do loop:
    # fica só na nota R-NN que o Editor Brain cria.
    o = str(d.get("origem", "")).strip().lower()
    if o.startswith("revisor"): continue
    (alts if do_thales(i, d) else tecnicas).append((i, d))

# limpa notas A-NN antigas geradas por este script
for f in os.listdir(ALT):
    if re.match(r"A-\d{2,3} ", f) and f.endswith(".md"):
        with open(os.path.join(ALT, f), encoding="utf-8") as fh:
            if "gerado: _SISTEMA/bin/registro.py" in fh.read(400):
                os.remove(os.path.join(ALT, f))

por_cliente, indice = {}, []
for n, (i, d) in enumerate(alts, 1):
    usados = set(META)
    antes = pega(d, K_ANTES, usados)
    pedido = pega(d, K_PEDIDO, usados)
    contexto = pega(d, K_CONTEXTO, usados)
    motivo = pega(d, K_MOTIVO, usados)
    resultado = pega(d, K_RESULTADO, usados)
    anterior = pega(d, K_ANTERIOR, usados)
    regra = pega(d, K_REGRA, usados)
    nivel = pega(d, K_NIVEL, usados)
    resto = {k: v for k, v in d.items() if k not in usados}
    slug = d.get("projeto", "") or ""
    cli = cliente_de(slug)
    skill = d.get("skill") or d.get("agente") or ""
    titulo = d.get("titulo") or TITULOS.get(i) or (pedido or antes)[:60]
    aid = f"A-{n:02d}"
    nome = limpa_nome(f"{aid} {titulo}")
    tags = ["alteração"]
    if cli: tags.append("cliente/" + re.sub(r"[^a-z0-9]+", "-", cli.lower()).strip("-"))
    if skill: tags.append("skill/" + re.sub(r"[^a-z0-9]+", "-", str(skill).lower()).strip("-"))
    out = ["---", "tipo: alteração", f"id: {aid}", f"data: {d.get('data','')}",
           f"projeto: {slug or '—'}", f"skill: {skill or '—'}", "origem: Thales",
           f"fonte: _SISTEMA/correcoes.jsonl#L{i}", "gerado: _SISTEMA/bin/registro.py",
           f"tags: [{', '.join(tags)}]", "---",
           f"# {aid} · {titulo}", "",
           f"**Cliente:** {'[[' + cli + ']]' if cli else '—'} · **Projeto:** {pasta_de(slug)} · **Data:** {d.get('data','')} · **Skill:** {skill or '—'}",
           "", "## O que o Thales pediu / corrigiu", q(pedido), "",
           "## Antes × depois", "", "| | |", "|---|---|",
           f"| **Antes (minha decisão)** | {antes.replace('|', '/') or '—'} |",
           f"| **Depois** | {(pedido or resultado).replace('|', '/') or '—'} |", ""]
    if contexto: out += ["## Contexto", contexto, ""]
    if motivo: out += ["## Por quê", motivo, ""]
    if resultado and resultado != pedido: out += ["## Resultado", resultado, ""]
    if anterior or regra:
        out += ["## O que virou regra"]
        if anterior: out += [f"- **Padrão anterior:** {anterior}"]
        if regra: out += [f"- **Padrão novo:** {regra}"]
        out += [""]
    if nivel: out += [f"**Nível de evidência:** {nivel}", ""]
    if resto:
        out += ["## Outros campos do registro"]
        out += [f"- **{k}:** {v}" for k, v in resto.items()]
        out += [""]
    out += ["---", f"Fonte: linha {i} de `_SISTEMA/correcoes.jsonl`. Nota gerada pelo script; para mudar o conteúdo, mude o jsonl e rode de novo."]
    with open(os.path.join(ALT, nome + ".md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    resumo = (pedido or antes).replace("\n", " ")
    if len(resumo) > 140: resumo = resumo[:137] + "…"
    item = f"- [[{nome}|{aid}]] · {d.get('data','')} · {titulo} — {resumo.replace('|', '/')}"
    indice.append((cli or "Sistema (sem projeto)", item))
    por_cliente.setdefault(cli, []).append(item)

# Lições técnicas
tl = ["---", "tipo: lições técnicas", "gerado: _SISTEMA/bin/registro.py", "tags: [registro, técnica, qc]", "---",
      "# Lições Técnicas · erros que eu mesmo achei", "",
      "Correções que **não** vieram do Thales: o loop interno (QC, regra de ouro, render, medição) pegou o erro antes ou depois da entrega. "
      "É a memória de oficina — Resolve, Fusion, render, ponte de arquivos, ASR. Os padrões recorrentes daqui estão resumidos em [[Padrões do Thales]] (seção *Do loop de QC*).",
      "", f"**{len(tecnicas)} registros** · fonte: `_SISTEMA/correcoes.jsonl` (gerado pelo script, não editar à mão).", "",
      "| # | Data | Projeto | Skill | Erro / condição | Correção |", "|---|---|---|---|---|---|"]
for i, d in tecnicas:
    u = set(META)
    cond = pega(d, ["condicao", "CONDICAO", "CONTEXT", "context"], u)
    err = pega(d, ["erro", "ERRO", "decisao_errada", "ORIGINAL_DECISION", "ORIGINAL", "original", "decisao_original", "decisao", "REGRA"], u)
    cor = pega(d, ["correcao", "CORRECAO", "CORRECTION", "corrigido", "decisao_corrigida", "USER_CORRECTION", "resultado", "RESULT", "learning", "ACIONAMENTOS"], u)
    e = (f"*{cond}* — " if cond and cond != err else "") + err
    c = lambda s: s.replace("|", "/").replace("\n", " ")
    tl.append(f"| L{i} | {d.get('data','')} | {d.get('projeto','—')} | {d.get('skill') or d.get('agente') or '—'} | {c(e)} | {c(cor)} |")
with open(os.path.join(REG, "Lições Técnicas.md"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(tl) + "\n")

def troca_bloco(path, corpo):
    if not os.path.exists(path): return False
    txt = open(path, encoding="utf-8").read()
    a, b = "<!-- alteracoes:inicio -->", "<!-- alteracoes:fim -->"
    if a not in txt: return False
    novo = txt.split(a)[0] + a + "\n" + corpo + "\n" + b + txt.split(b, 1)[1]
    open(path, "w", encoding="utf-8").write(novo)
    return True

# índice geral, agrupado por cliente
grupos = {}
for cli, item in indice: grupos.setdefault(cli, []).append(item)
corpo = []
for cli in sorted(grupos, key=lambda c: (c.startswith("Sistema"), c)):
    nome = cli if cli.startswith("Sistema") else f"[[{cli}]]"
    corpo += [f"### {nome}", *grupos[cli], ""]
troca_bloco(os.path.join(REG, "Registro de Decisões.md"), "\n".join(corpo))
for cli, items in por_cliente.items():
    if cli: troca_bloco(os.path.join(CLI, cli + ".md"), "\n".join(items))

print(f"alterações: {len(alts)} · lições técnicas: {len(tecnicas)}")
