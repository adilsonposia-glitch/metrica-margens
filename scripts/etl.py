# -*- coding: utf-8 -*-
"""ETL trimestral: venda + perda por cluster -> js/data.js"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "js" / "data.js"

BACKOFFICE_VALOR = 9_623_706.0
LUCRO_ALVO = 0.04
DESPESA = {"A": 0.2309, "B": 0.1720}

LOJAS = {
    "A": [
        {"codigo": "01", "nome": "Americas"},
        {"codigo": "07", "nome": "Abelardo"},
        {"codigo": "10", "nome": "Barra"},
        {"codigo": "11", "nome": "Via Parque"},
        {"codigo": "13", "nome": "Tanque"},
    ],
    "B": [
        {"codigo": "05", "nome": "Loja 05"},
        {"codigo": "08", "nome": "Magarca"},
        {"codigo": "09", "nome": "Riachuelo"},
        {"codigo": "12", "nome": "C. Grande"},
        {"codigo": "14", "nome": "Cascadura"},
        {"codigo": "15", "nome": "Pedra"},
        {"codigo": "16", "nome": "Terreirao"},
        {"codigo": "17", "nome": "P. Lucas"},
    ],
}

FILES = {
    "A": {
        "venda": "Cluster A Venda Varejo Trimestre.csv",
        "perda": "Cluster A Perdas QuebrasTrimestre.csv",
    },
    "B": {
        "venda": "Cluster B Venda Varejo Trimestre.csv",
        "perda": "Cluster B Perdas QuebrasTrimestre.csv",
    },
}


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


def read_rows(path: Path) -> list[list[str]]:
    text = decode(path)
    rows = list(csv.reader(text.splitlines(), delimiter=";"))
    return [r for r in rows[1:] if r and len(r) >= 2]


def col(row: list[str], idx: int) -> str:
    return row[idx] if idx < len(row) else ""


def key_of(n1: str, n2: str, n3: str, n4: str) -> str:
    return "|".join((n1, n2, n3, n4))


def main() -> None:
    linhas = []
    log = {
        "excluido_nao_revenda": 0,
        "excluido_sacola": 0,
        "venda_sem_perda": 0,
        "perda_sem_venda": 0,
        "bruto_venda": {"A": 0, "B": 0},
        "liquido_venda_rows": {"A": 0, "B": 0},
    }
    perda_orfas = []

    for cluster, files in FILES.items():
        vendas = read_rows(ROOT / files["venda"])
        perdas = read_rows(ROOT / files["perda"])
        log["bruto_venda"][cluster] = len(vendas)

        # Perda: 1=Nivel 4, 14=Vlr Diferenca, 18=Valor Custo Liquido
        perda_map: dict[str, dict] = {}
        for row in perdas:
            n1, n2, n3, n4 = split_n4(col(row, 1))
            if excluded(n1, n4):
                continue
            perda_map[key_of(n1, n2, n3, n4)] = {
                "custoQuebra": num(col(row, 18)),
                "vlrQuebra": num(col(row, 14)),
            }

        seen: set[str] = set()
        # Venda: 1=Nivel 4, 2=qtd, 3=itens, 5=venda, 11=lucro, 13=margem%, 17=custo liq, 21=impostos
        for row in vendas:
            n1, n2, n3, n4 = split_n4(col(row, 1))
            if n1.upper() == "NAO REVENDA":
                log["excluido_nao_revenda"] += 1
                continue
            if "SACOLA RECICLAVEL" in n4.upper():
                log["excluido_sacola"] += 1
                continue
            k = key_of(n1, n2, n3, n4)
            seen.add(k)
            perda = perda_map.get(k, {"custoQuebra": 0.0, "vlrQuebra": 0.0})
            if k not in perda_map:
                log["venda_sem_perda"] += 1

            venda = num(col(row, 5))
            linhas.append(
                {
                    "cluster": cluster,
                    "n1": n1,
                    "n2": n2,
                    "n3": n3,
                    "n4": n4,
                    "venda": round(venda, 2),
                    "qtd": round(num(col(row, 2)), 3),
                    "itens": int(num(col(row, 3))),
                    "lucroValor": round(num(col(row, 11)), 2),
                    "margemReal": round(num(col(row, 13)) / 100.0, 6),
                    "custoLiquido": round(num(col(row, 17)), 2),
                    "impostos": round(num(col(row, 21)), 2),
                    "custoQuebra": round(perda["custoQuebra"], 2),
                    "vlrQuebra": round(perda["vlrQuebra"], 2),
                }
            )
            log["liquido_venda_rows"][cluster] += 1

        for k, perda in perda_map.items():
            if k not in seen:
                log["perda_sem_venda"] += 1
                n1, n2, n3, n4 = k.split("|")
                perda_orfas.append(
                    {
                        "cluster": cluster,
                        "n1": n1,
                        "n2": n2,
                        "n3": n3,
                        "n4": n4,
                        "custoQuebra": round(perda["custoQuebra"], 2),
                        "vlrQuebra": round(perda["vlrQuebra"], 2),
                    }
                )

    venda_total = sum(x["venda"] for x in linhas)

    def custo_perda(v: float) -> float:
        return abs(v) if v < 0 else 0.0

    custo_quebra_total = sum(custo_perda(x["custoQuebra"]) for x in linhas)
    payload = {
        "meta": {
            "periodo": "01/04/2026 a 30/06/2026",
            "periodoLabel": "2o trimestre 2026",
            "fonteVenda": "ABC Venda Varejo - Nivel 4",
            "fontePerda": "Analise de movimentacao - CGOs 401, 501, 553, 558, 559",
            "backofficeValor": BACKOFFICE_VALOR,
            "lucroAlvo": LUCRO_ALVO,
            "vendaTotalEmpresa": round(venda_total, 2),
            "backofficePerc": round(BACKOFFICE_VALOR / venda_total, 8) if venda_total else 0,
            "clusters": {
                "A": {
                    "nome": "Cluster A",
                    "criterio": "Margem > 30%",
                    "despesa": DESPESA["A"],
                    "lojas": LOJAS["A"],
                },
                "B": {
                    "nome": "Cluster B",
                    "criterio": "Margem entre 26% e 29%",
                    "despesa": DESPESA["B"],
                    "lojas": LOJAS["B"],
                },
            },
            "exclusoes": [
                "Departamento NAO REVENDA (frete, almoxarifado, reciclaveis, materia-prima)",
                "Subgrupo SACOLA RECICLAVEL (quebra operacional de sacola)",
            ],
            "formula": "MB = perda% + despesa_cluster + backoffice% + lucro%",
            "hookMercado": "CSV futuro: n1;n2;n3;n4;margem_mercado_pct",
        },
        "linhas": linhas,
        "perdaSemVenda": perda_orfas,
        "log": {
            **log,
            "custoQuebraAbs": round(custo_quebra_total, 2),
            "linhasGabarito": len(linhas),
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = "window.BASE_DADOS = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    OUT.write_text(body, encoding="utf-8")

    print("OK", OUT)
    print("linhas", len(linhas), "venda", round(venda_total, 2), "BO%", round(payload["meta"]["backofficePerc"] * 100, 4))
    print("A", round(sum(x["venda"] for x in linhas if x["cluster"] == "A"), 2))
    print("B", round(sum(x["venda"] for x in linhas if x["cluster"] == "B"), 2))
    print("log", payload["log"])


if __name__ == "__main__":
    main()
