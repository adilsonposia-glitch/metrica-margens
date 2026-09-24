# -*- coding: utf-8 -*-
"""Acrescenta o 1o trimestre (ABC jan/fev/mar + DRE WhatsApp) em js/data.js.
Nao reprocessa nem altera as linhas do 2o trimestre.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_JS = ROOT / "js" / "data.js"
DRE_JSON = ROOT / "dados" / "dre-2026-t1-whatsapp.json"

ABC_FILES = [
    "ABC Venda Janeiro26.csv",
    "ABC Venda Fevereiro26.csv",
    "ABC Venda Marco26.csv",
]

CLUSTER = {
    "01": "A",
    "07": "A",
    "10": "A",
    "11": "A",
    "13": "A",
    "05": "B",
    "08": "B",
    "09": "B",
    "12": "B",
    "14": "B",
    "15": "B",
    "16": "B",
    "17": "B",
}

PREFIX = re.compile(r"^(\d+)\s*-\s*[^:]+\s*:\s*(.*)$")


def decode(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def num(value: str | None) -> float:
    if value is None:
        return 0.0
    text = str(value).strip()
    if text == "":
        return 0.0
    text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 0.0


def split_n4(raw: str) -> tuple[str, str, str, str]:
    parts = [p.strip() for p in raw.strip().strip('"').split("\\") if p.strip()]
    while len(parts) < 4:
        parts.append("")
    return parts[0], parts[1], parts[2], parts[3]


def excluded(n1: str, n4: str) -> bool:
    if n1.upper() == "NAO REVENDA":
        return True
    if "SACOLA RECICLAVEL" in n4.upper():
        return True
    return False


def load_existing() -> dict:
    text = DATA_JS.read_text(encoding="utf-8")
    text = text.strip()
    if text.startswith("window.BASE_DADOS"):
        text = text.split("=", 1)[1].strip()
    if text.endswith(";"):
        text = text[:-1]
    return json.loads(text)


def dre_despesas() -> dict[str, float]:
    dre = json.loads(DRE_JSON.read_text(encoding="utf-8"))
    acc = {"A": {"desp": 0.0, "rec": 0.0}, "B": {"desp": 0.0, "rec": 0.0}}
    for loja in dre["lojas"]:
        cl = CLUSTER.get(loja["codigo"])
        if not cl:
            continue
        rec = float(loja.get("receita_venda_devolucao") or 0)
        desp = abs(float(loja.get("total_despesas") or 0))
        acc[cl]["rec"] += rec
        acc[cl]["desp"] += desp
    return {
        cl: (acc[cl]["desp"] / acc[cl]["rec"] if acc[cl]["rec"] else 0.0)
        for cl in ("A", "B")
    }


def read_abc_month(path: Path, bucket: dict, log: dict) -> None:
    rows = list(csv.reader(decode(path).splitlines(), delimiter=";"))
    for row in rows[1:]:
        if len(row) < 15:
            log["linhas_curtas"] += 1
            continue
        raw = row[2]
        m = PREFIX.match(raw)
        if not m:
            log["sem_prefixo"] += 1
            continue
        codigo = m.group(1).zfill(2)
        cluster = CLUSTER.get(codigo)
        if not cluster:
            log["fora_cluster"] += 1
            continue
        n1, n2, n3, n4 = split_n4(m.group(2))
        if n1.upper() == "NAO REVENDA":
            log["excluido_nao_revenda"] += 1
            continue
        if "SACOLA RECICLAVEL" in n4.upper():
            log["excluido_sacola"] += 1
            continue
        key = (cluster, n1, n2, n3, n4)
        item = bucket.get(key)
        if item is None:
            item = {
                "cluster": cluster,
                "n1": n1,
                "n2": n2,
                "n3": n3,
                "n4": n4,
                "venda": 0.0,
                "qtd": 0.0,
                "itens": 0,
                "lucroValor": 0.0,
                "custoLiquido": 0.0,
                "impostos": 0.0,
                "custoQuebra": 0.0,
                "vlrQuebra": 0.0,
                "periodo": "T1",
            }
            bucket[key] = item
        item["venda"] += num(row[6])
        item["qtd"] += num(row[3])
        item["itens"] += int(num(row[4]))
        item["lucroValor"] += num(row[12])
        item["custoLiquido"] += num(row[18]) if len(row) > 18 else 0.0
        item["impostos"] += num(row[22]) if len(row) > 22 else 0.0
        log["linhas_abc"] += 1


def main() -> None:
    payload = load_existing()
    for row in payload["linhas"]:
        row.setdefault("periodo", "T2")

    bucket: dict = {}
    log = {
        "linhas_abc": 0,
        "linhas_curtas": 0,
        "sem_prefixo": 0,
        "fora_cluster": 0,
        "excluido_nao_revenda": 0,
        "excluido_sacola": 0,
    }
    for name in ABC_FILES:
        read_abc_month(ROOT / name, bucket, log)

    t1 = []
    for item in bucket.values():
        venda = item["venda"]
        item["venda"] = round(venda, 2)
        item["qtd"] = round(item["qtd"], 3)
        item["lucroValor"] = round(item["lucroValor"], 2)
        item["custoLiquido"] = round(item["custoLiquido"], 2)
        item["impostos"] = round(item["impostos"], 2)
        item["margemReal"] = round(item["lucroValor"] / venda, 6) if venda else 0.0
        t1.append(item)

    t1.sort(key=lambda r: (r["cluster"], r["n1"], r["n2"], r["n3"], r["n4"]))
    payload["linhas"] = [r for r in payload["linhas"] if r.get("periodo") != "T1"] + t1

    desp_t1 = dre_despesas()
    venda_t1 = {cl: sum(x["venda"] for x in t1 if x["cluster"] == cl) for cl in ("A", "B")}
    venda_t2 = {
        cl: sum(x["venda"] for x in payload["linhas"] if x.get("periodo") == "T2" and x["cluster"] == cl)
        for cl in ("A", "B")
    }
    desp_t2 = {
        "A": payload["meta"]["clusters"]["A"]["despesa"],
        "B": payload["meta"]["clusters"]["B"]["despesa"],
    }
    desp_t12 = {}
    for cl in ("A", "B"):
        den = venda_t1[cl] + venda_t2[cl]
        desp_t12[cl] = (
            (desp_t1[cl] * venda_t1[cl] + desp_t2[cl] * venda_t2[cl]) / den if den else desp_t2[cl]
        )

    venda_t1_emp = round(sum(venda_t1.values()), 2)
    venda_t2_emp = round(sum(venda_t2.values()), 2)
    venda_t12_emp = round(venda_t1_emp + venda_t2_emp, 2)
    bo = payload["meta"]["backofficeValor"]

    payload["meta"]["periodoDefault"] = "T2"
    payload["meta"]["periodos"] = {
        "T1": {
            "id": "T1",
            "label": "1o trimestre 2026",
            "periodo": "01/01/2026 a 31/03/2026",
            "fonteVenda": "ABC Venda Janeiro/Fevereiro/Marco 2026",
            "fonteDespesa": "DRE WhatsApp Barra Oeste BI",
            "despesa": {"A": round(desp_t1["A"], 6), "B": round(desp_t1["B"], 6)},
            "vendaTotalEmpresa": venda_t1_emp,
            "backofficePerc": payload["meta"]["backofficePerc"],
            "notaPerda": "Sem arquivo de quebra do T1; a perda da formula permanece a historica do T2.",
        },
        "T2": {
            "id": "T2",
            "label": payload["meta"]["periodoLabel"],
            "periodo": payload["meta"]["periodo"],
            "fonteVenda": payload["meta"].get("fonteVenda", ""),
            "fonteDespesa": "Historico do gabarito",
            "despesa": {"A": desp_t2["A"], "B": desp_t2["B"]},
            "vendaTotalEmpresa": venda_t2_emp,
            "backofficePerc": payload["meta"]["backofficePerc"],
            "notaPerda": "",
        },
        "T12": {
            "id": "T12",
            "label": "1o + 2o trimestre 2026",
            "periodo": "01/01/2026 a 30/06/2026",
            "fonteVenda": "ABC T1 + ABC T2",
            "fonteDespesa": "DRE T1 ponderado com despesa historica T2",
            "despesa": {"A": round(desp_t12["A"], 6), "B": round(desp_t12["B"], 6)},
            "vendaTotalEmpresa": venda_t12_emp,
            "backofficePerc": payload["meta"]["backofficePerc"],
            "notaPerda": "Quebra so do T2; media ponderada pela venda dos dois trimestres.",
        },
    }
    payload["logT1"] = {
        **log,
        "linhasT1": len(t1),
        "vendaT1": venda_t1,
        "despesaT1": {k: round(v, 6) for k, v in desp_t1.items()},
        "despesaT12": {k: round(v, 6) for k, v in desp_t12.items()},
    }

    DATA_JS.write_text(
        "window.BASE_DADOS = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print("OK", DATA_JS)
    print("T1 linhas", len(t1), "venda A", round(venda_t1["A"], 2), "B", round(venda_t1["B"], 2))
    print("desp T1", {k: round(v * 100, 2) for k, v in desp_t1.items()})
    print("desp T12", {k: round(v * 100, 2) for k, v in desp_t12.items()})
    print("log", payload["logT1"])


if __name__ == "__main__":
    main()
