(() => {
  const DATA = window.BASE_DADOS;
  if (!DATA) {
    document.body.innerHTML = "<p style='padding:40px'>Base não carregada. Rode scripts/etl.py.</p>";
    return;
  }

  const STORE_KEY = "metrica-margens-sim-v4";
  const state = {
    cluster: "A",
    periodo: "T2",
    path: [],
    nivel: "n1",
    busca: "",
    selected: null,
    mercado: {},
    sim: loadSim(),
  };
  if (state.sim.periodo && DATA.meta.periodos && DATA.meta.periodos[state.sim.periodo]) {
    state.periodo = state.sim.periodo;
  }

  const els = {
    kpis: document.getElementById("kpis"),
    lojas: document.getElementById("lojasLine"),
    formula: document.getElementById("formulaStrip"),
    crumbs: document.getElementById("crumbs"),
    body: document.getElementById("gridBody"),
    foot: document.getElementById("tableFoot"),
    memoryEmpty: document.getElementById("memoryEmpty"),
    memoryBody: document.getElementById("memoryBody"),
    busca: document.getElementById("busca"),
    nivel: document.getElementById("nivelView"),
    toast: document.getElementById("toast"),
    periodo: document.getElementById("periodoLabel"),
    boNote: document.getElementById("boNote"),
  };

  function linhasT2() {
    return DATA.linhas.filter(function (r) { return !r.periodo || r.periodo === "T2"; });
  }

  function linhasT1() {
    return DATA.linhas.filter(function (r) { return r.periodo === "T1"; });
  }

  function mergeLinhas(a, b) {
    const map = {};
    function add(r) {
      const k = r.cluster + "|" + r.n1 + "|" + r.n2 + "|" + r.n3 + "|" + r.n4;
      if (!map[k]) {
        map[k] = {
          cluster: r.cluster, n1: r.n1, n2: r.n2, n3: r.n3, n4: r.n4,
          venda: 0, qtd: 0, itens: 0, lucroValor: 0, custoLiquido: 0, impostos: 0,
          custoQuebra: 0, vlrQuebra: 0, periodo: "T12"
        };
      }
      const g = map[k];
      g.venda += r.venda || 0;
      g.qtd += r.qtd || 0;
      g.itens += r.itens || 0;
      g.lucroValor += r.lucroValor || 0;
      g.custoLiquido += r.custoLiquido || 0;
      g.impostos += r.impostos || 0;
      g.custoQuebra += r.custoQuebra || 0;
      g.vlrQuebra += r.vlrQuebra || 0;
    }
    a.forEach(add);
    b.forEach(add);
    return Object.keys(map).map(function (k) {
      const g = map[k];
      g.margemReal = g.venda ? g.lucroValor / g.venda : 0;
      return g;
    });
  }

  let _ativasCache = { key: "", rows: null };
  function linhasAtivas() {
    if (_ativasCache.key === state.periodo && _ativasCache.rows) return _ativasCache.rows;
    let rows;
    if (state.periodo === "T1") rows = linhasT1();
    else if (state.periodo === "T12") rows = mergeLinhas(linhasT2(), linhasT1());
    else rows = linhasT2();
    _ativasCache = { key: state.periodo, rows: rows };
    return rows;
  }

  function metaPeriodo() {
    const periodos = DATA.meta.periodos || {};
    return periodos[state.periodo] || {
      label: DATA.meta.periodoLabel,
      periodo: DATA.meta.periodo,
      despesa: { A: DATA.meta.clusters.A.despesa, B: DATA.meta.clusters.B.despesa },
      vendaTotalEmpresa: DATA.meta.vendaTotalEmpresa,
      backofficePerc: DATA.meta.backofficePerc,
      notaPerda: ""
    };
  }

  function applyPeriodLabel() {
    const p = metaPeriodo();
    if (els.periodo) els.periodo.textContent = p.label + " | " + p.periodo;
    document.title = "Gabarito de Margens | " + p.label;
  }

  function applyPeriodDefaults() {
    const p = metaPeriodo();
    if (p.despesa) {
      state.sim.despesaA = p.despesa.A;
      state.sim.despesaB = p.despesa.B;
    }
    if (p.backofficePerc != null) state.sim.backoffice = p.backofficePerc;
    applyPeriodLabel();
    if (typeof syncSimInputs === "function") syncSimInputs();
  }

  function perdaHistCluster(cl) {
    const rows = linhasT2().filter(function (r) { return r.cluster === cl; });
    const venda = rows.reduce(function (s, r) { return s + r.venda; }, 0);
    const perda = rows.reduce(function (s, r) { return s + custoQuebra(r.custoQuebra); }, 0);
    return venda ? perda / venda : 0;
  }

  const PERDA_HIST = { A: perdaHistCluster("A"), B: perdaHistCluster("B") };
  const PERDA_T2_MAP = {};
  linhasT2().forEach(function (r) {
    const v = r.venda || 0;
    PERDA_T2_MAP[r.cluster + "|" + r.n1 + "|" + r.n2 + "|" + r.n3 + "|" + r.n4] = {
      venda: v,
      perda: v > 0 ? custoQuebra(r.custoQuebra) / v : 0
    };
  });

  function loadSim() {
    const base = {
      lucro: DATA.meta.lucroAlvo,
      despesaA: DATA.meta.clusters.A.despesa,
      despesaB: DATA.meta.clusters.B.despesa,
      backoffice: DATA.meta.backofficePerc,
      perdaA: perdaHistCluster("A"),
      perdaB: perdaHistCluster("B"),
      protegerFluxo: true,
      antiRegressao: true,
      pisoExtra: 0.02,
      pesoDespFluxo: 0.45,
      pesoLucroFluxo: 0.25,
      overrides: {},
      savedOverrides: {},
    };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved) {
        const ov = saved.overrides || {};
        return Object.assign({}, base, saved, {
          overrides: ov,
          savedOverrides: saved.savedOverrides || ov,
        });
      }
    } catch (_) {}
    return base;
  }

  function persist() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.sim));
  }

  function cloneOverrides(map) {
    const out = {};
    Object.keys(map || {}).forEach(function (k) {
      const v = map[k];
      if (!v) return;
      out[k] = {};
      if (v.margem != null) out[k].margem = v.margem;
      if (v.perdaPct != null) out[k].perdaPct = v.perdaPct;
    });
    return out;
  }

  function overrideCount(map) {
    let n = 0;
    Object.keys(map || {}).forEach(function (k) {
      if (map[k] && map[k].margem != null) n += 1;
    });
    return n;
  }

  function overridesDirty() {
    const a = state.sim.overrides || {};
    const b = state.sim.savedOverrides || {};
    const keys = {};
    Object.keys(a).forEach(function (k) { keys[k] = true; });
    Object.keys(b).forEach(function (k) { keys[k] = true; });
    return Object.keys(keys).some(function (k) {
      const am = a[k] && a[k].margem;
      const bm = b[k] && b[k].margem;
      return am !== bm;
    });
  }

  function renderSaveBtn() {
    const btn = document.getElementById("btnSave");
    if (!btn) return;
    const n = overrideCount(state.sim.overrides);
    const dirty = overridesDirty();
    btn.classList.toggle("pending", dirty);
    if (!n) btn.textContent = "Salvar altera\u00e7\u00f5es";
    else if (dirty) btn.textContent = "Salvar altera\u00e7\u00f5es (" + n + ")";
    else btn.textContent = "Altera\u00e7\u00f5es salvas (" + n + ")";
  }

  function saveAlteracoes() {
    state.sim.savedOverrides = cloneOverrides(state.sim.overrides);
    persist();
    renderSaveBtn();
    const n = overrideCount(state.sim.savedOverrides);
    toast(n
      ? ("Altera\u00e7\u00f5es salvas: " + n + " subgrupos entram no Excel.")
      : "Nenhuma remarca\u00e7\u00e3o para salvar. O Excel seguir\u00e1 a proposta do simulador.");
    return n;
  }

  function custoQuebra(v) { return v < 0 ? -v : 0; }

  function brl(v) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function pct(v, digits) {
    digits = digits == null ? 2 : digits;
    return (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "%";
  }

  function numPct(v) { return Number((v * 100).toFixed(2)); }

  function rowKey(r) {
    return r.cluster + "|" + r.n1 + "|" + r.n2 + "|" + r.n3 + "|" + r.n4;
  }

  function enrichBase(row, totV, totQ) {
    const venda = row.venda || 0;
    const perdaAbs = custoQuebra(row.custoQuebra);
    const perdaAlvo = row.cluster === "A" ? state.sim.perdaA : state.sim.perdaB;
    const perdaBase = row.cluster === "A" ? PERDA_HIST.A : PERDA_HIST.B;
    let perdaHist = venda > 0 ? perdaAbs / venda : 0;
    if (row.periodo === "T1" && perdaHist === 0 && perdaBase > 0) {
      const t2 = PERDA_T2_MAP[row.cluster + "|" + row.n1 + "|" + row.n2 + "|" + row.n3 + "|" + row.n4];
      if (t2 && t2.venda > 0) perdaHist = t2.perda;
      else perdaHist = perdaBase;
    }
    const escala = perdaBase > 0 ? perdaAlvo / perdaBase : 1;
    const perdaPct = perdaHist * escala;
    const desp = row.cluster === "A" ? state.sim.despesaA : state.sim.despesaB;
    const key = rowKey(row);
    const ov = state.sim.overrides[key] || {};
    const unit = row.qtd ? venda / row.qtd : 0;
    const pv = totV ? venda / totV : 0;
    const pq = totQ ? row.qtd / totQ : 0;
    const inten = pq > 0 ? pv / pq : 1;
    let papel = "equilibrio";
    if (row.n3 === "BOVINO" || inten >= 2) papel = "fluxo";
    else if (inten <= 0.5) papel = "lucro";
    const cheia = perdaPct + desp + state.sim.backoffice + state.sim.lucro;
    const real = venda > 0 ? row.lucroValor / venda : row.margemReal || 0;
    return Object.assign({}, row, {
      key: key,
      perdaAbs: perdaAbs,
      perdaHist: perdaHist,
      perdaPct: perdaPct,
      desp: desp,
      unit: unit,
      inten: inten,
      papel: papel,
      propostaCheia: cheia,
      propostaCalc: cheia,
      carregar: cheia,
      real: real,
      ov: ov,
      trafego: false,
      excedenteRs: 0,
    });
  }

  const TRAFEGO_NOMEADO = {
    "LEITE UHT INTEGRAL": true,
    "OLEO DE SOJA": true,
    "ARROZ BRANCO": true,
    "FEIJAO PRETO": true,
  };

  function areaN2(r) {
    return r.n1 + "|" + r.n2;
  }

  function pickTrafegoAuto(group) {
    const live = group.filter(function (r) { return r.venda > 0 && r.qtd > 0 && r.unit > 0; });
    if (!live.length) return [];
    const units = live.map(function (r) { return r.unit; }).sort(function (a, b) { return a - b; });
    const p60 = units[Math.min(units.length - 1, Math.floor(units.length * 0.6))];
    const cheap = live.filter(function (r) { return r.unit <= p60 * 1.15; });
    const pool = cheap.length ? cheap : live;
    pool.sort(function (a, b) { return b.qtd - a.qtd; });
    const out = [pool[0]];
    if (pool[1] && pool[1].n3 !== pool[0].n3 && pool[1].qtd >= 0.45 * pool[0].qtd) {
      out.push(pool[1]);
    }
    return out;
  }

  function markTrafego(rows) {
    rows.forEach(function (r) {
      r.trafego = !!TRAFEGO_NOMEADO[r.n4];
      r.excedenteRs = 0;
    });
    const byN2 = {};
    rows.forEach(function (r) {
      const k = areaN2(r);
      (byN2[k] = byN2[k] || []).push(r);
    });
    Object.keys(byN2).forEach(function (k) {
      const g = byN2[k];
      if (g.some(function (r) { return r.trafego; })) return;
      pickTrafegoAuto(g).forEach(function (r) { r.trafego = true; });
    });
  }

  function aplicarCorteMargem(dest, surplusRs) {
    dest = dest.filter(function (r) {
      return !r.piso && r.venda > 0 && r.propostaCalc > r.real + 1e-8;
    });
    if (surplusRs <= 1e-6 || !dest.length) return surplusRs;
    const headroomRs = dest.reduce(function (s, r) {
      return s + (r.propostaCalc - r.real) * r.venda;
    }, 0);
    if (headroomRs <= 1e-6) return surplusRs;
    const used = Math.min(surplusRs, headroomRs);
    dest.forEach(function (r) {
      const room = (r.propostaCalc - r.real) * r.venda;
      const corte = used * (room / headroomRs);
      r.propostaCalc -= corte / r.venda;
      r.excedenteRs = (r.excedenteRs || 0) + corte;
      if (r.propostaCalc < r.real) r.propostaCalc = r.real;
    });
    return surplusRs - used;
  }

  function redistribuirExcedentePiso(rows) {
    const byN2 = {};
    rows.forEach(function (r) {
      const k = areaN2(r);
      (byN2[k] = byN2[k] || []).push(r);
    });
    const leftoverN1 = {};
    Object.keys(byN2).forEach(function (k) {
      const g = byN2[k];
      let surplus = g.reduce(function (s, r) {
        if (!r.piso) return s;
        return s + (r.propostaCalc - r.propostaPrePiso) * r.venda;
      }, 0);
      surplus = aplicarCorteMargem(g.filter(function (r) { return r.trafego; }), surplus);
      if (surplus > 1e-6) leftoverN1[g[0].n1] = (leftoverN1[g[0].n1] || 0) + surplus;
    });
    let leftoverCluster = 0;
    Object.keys(leftoverN1).forEach(function (n1) {
      leftoverN1[n1] = aplicarCorteMargem(rows.filter(function (r) {
        return r.n1 === n1 && r.trafego;
      }), leftoverN1[n1]);
      leftoverCluster += leftoverN1[n1];
    });
    if (leftoverCluster > 1e-6) {
      leftoverCluster = aplicarCorteMargem(rows.filter(function (r) { return r.trafego; }), leftoverCluster);
    }
    if (leftoverCluster > 1e-6) {
      aplicarCorteMargem(rows.filter(function (r) { return r.papel === "fluxo"; }), leftoverCluster);
    }
  }

  function capCompetitividade(rows) {
    rows.forEach(function (r) {
      if (!r.trafego) return;
      const mercado = state.mercado[r.n4] || state.mercado[r.key];
      if (mercado == null) return;
      if (r.propostaCalc > mercado) {
        r.propostaCalc = mercado > r.real ? mercado : r.real;
      }
    });
  }

  function rebalanceCluster(rows) {
    const totV = rows.reduce(function (s, r) { return s + r.venda; }, 0);
    if (!totV) return rows;
    const target = rows.reduce(function (s, r) { return s + r.propostaCheia * r.venda; }, 0) / totV;
    const anti = state.sim.antiRegressao !== false;
    const pisoExtra = anti ? (state.sim.pisoExtra || 0.02) : 0;
    markTrafego(rows);

    rows.forEach(function (r) {
      r.piso = false;
      r.propostaPrePiso = r.propostaCheia;
      if (state.sim.protegerFluxo && r.papel === "fluxo") {
        var p = r.perdaPct + r.desp * state.sim.pesoDespFluxo + state.sim.backoffice + state.sim.lucro * state.sim.pesoLucroFluxo;
        if (p < r.real) p = r.real;
        if (p > r.propostaCheia) p = r.propostaCheia;
        r.propostaCalc = p;
      } else {
        r.propostaCalc = r.propostaCheia;
      }
    });

    if (state.sim.protegerFluxo) {
      const atual = rows.reduce(function (s, r) { return s + r.propostaCalc * r.venda; }, 0) / totV;
      const shortfall = target - atual;
      const baseV = rows.reduce(function (s, r) {
        if (r.papel === "fluxo" || r.trafego) return s;
        if (anti && r.propostaCalc < r.real) return s;
        return s + r.venda;
      }, 0);
      if (shortfall > 0 && baseV > 0) {
        const extra = Math.min(shortfall * totV / baseV, 0.04);
        rows.forEach(function (r) {
          if (r.papel === "fluxo" || r.trafego) return;
          if (anti && r.propostaCalc < r.real) return;
          r.propostaCalc += extra;
        });
      }
    }

    if (anti) {
      rows.forEach(function (r) {
        r.propostaPrePiso = r.propostaCalc;
        if (r.propostaCalc < r.real) {
          r.propostaCalc = r.real + pisoExtra;
          r.piso = true;
        }
      });
      redistribuirExcedentePiso(rows);
    }

    capCompetitividade(rows);

    rows.forEach(function (r) {
      r.carregar = r.ov.margem != null ? r.ov.margem : r.propostaCalc;
      r.gap = r.carregar - r.real;
      if (r.gap > -1e-8 && r.gap < 1e-8) r.gap = 0;
      r.impacto = r.gap * r.venda;
      r.alterado = r.ov.margem != null || r.ov.perdaPct != null;
    });
    return rows;
  }

  function allEnriched() {
    const linhas = linhasAtivas();
    const tot = { A: { v: 0, q: 0 }, B: { v: 0, q: 0 } };
    linhas.forEach(function (r) {
      tot[r.cluster].v += r.venda;
      tot[r.cluster].q += r.qtd;
    });
    const base = linhas.map(function (r) {
      return enrichBase(r, tot[r.cluster].v, tot[r.cluster].q);
    });
    const a = rebalanceCluster(base.filter(function (r) { return r.cluster === "A"; }));
    const b = rebalanceCluster(base.filter(function (r) { return r.cluster === "B"; }));
    return a.concat(b);
  }

  function clusterRows() {
    let rows = allEnriched().filter((r) => r.cluster === state.cluster);
    state.path.forEach((p) => { rows = rows.filter((r) => r[p.field] === p.value); });
    if (state.busca.trim()) {
      const q = state.busca.trim().toUpperCase();
      rows = rows.filter((r) => (r.n1 + " " + r.n2 + " " + r.n3 + " " + r.n4).toUpperCase().includes(q));
    }
    return rows;
  }

  function aggregate(rows, nivel) {
    const fields = { n1: ["n1"], n2: ["n1", "n2"], n3: ["n1", "n2", "n3"], n4: ["n1", "n2", "n3", "n4"] }[nivel];
    const map = new Map();
    for (const r of rows) {
      const k = fields.map((f) => r[f]).join("|");
      if (!map.has(k)) {
        map.set(k, {
          cluster: r.cluster,
          n1: r.n1,
          n2: fields.includes("n2") ? r.n2 : "",
          n3: fields.includes("n3") ? r.n3 : "",
          n4: fields.includes("n4") ? r.n4 : "",
          nivel: nivel,
          venda: 0, qtd: 0, lucroValor: 0, perdaAbs: 0, perdaPond: 0, impacto: 0,
          propostaPond: 0, carregarPond: 0, n: 0, alterados: 0, pisoN: 0,
          trafegoN: 0, excedenteRs: 0, trafegoNomes: [],
          papeles: {},
        });
      }
      const g = map.get(k);
      g.venda += r.venda;
      g.qtd += r.qtd;
      g.lucroValor += r.lucroValor;
      g.perdaAbs += r.perdaAbs;
      g.perdaPond += r.perdaPct * r.venda;
      g.impacto += r.impacto;
      g.propostaPond += r.propostaCalc * r.venda;
      g.carregarPond += r.carregar * r.venda;
      g.n += 1;
      if (r.alterado) g.alterados += 1;
      if (r.piso) g.pisoN += 1;
      if (r.trafego) {
        g.trafegoN += 1;
        if (g.trafegoNomes.indexOf(r.n4) < 0) g.trafegoNomes.push(r.n4);
      }
      g.excedenteRs += r.excedenteRs || 0;
      g.papeles[r.papel] = (g.papeles[r.papel] || 0) + r.venda;
    }
    return Array.from(map.values()).map((g) => {
      const real = g.venda ? g.lucroValor / g.venda : 0;
      const proposta = g.venda ? g.propostaPond / g.venda : 0;
      const carregar = g.venda ? g.carregarPond / g.venda : 0;
      const papel = Object.keys(g.papeles).sort(function (a, b) { return g.papeles[b] - g.papeles[a]; })[0] || "equilibrio";
      const misto = Object.keys(g.papeles).length > 1;
      return Object.assign({}, g, {
        name: g.n4 || g.n3 || g.n2 || g.n1,
        real: real,
        proposta: proposta,
        carregar: carregar,
        perdaPct: g.venda ? g.perdaPond / g.venda : 0,
        unit: g.qtd ? g.venda / g.qtd : 0,
        papel: misto ? "misto" : papel,
        trafego: !misto && g.trafegoN > 0,
        gap: carregar - real,
        desp: state.cluster === "A" ? state.sim.despesaA : state.sim.despesaB,
      });
    }).sort((a, b) => b.venda - a.venda);
  }

  function totals(rows) {
    const venda = rows.reduce((s, r) => s + r.venda, 0);
    const lucroValor = rows.reduce((s, r) => s + r.lucroValor, 0);
    const perdaAbsLida = rows.reduce((s, r) => s + r.perdaAbs, 0);
    const impacto = rows.reduce((s, r) => s + r.impacto, 0);
    const propostaPond = rows.reduce((s, r) => s + r.propostaCalc * r.venda, 0);
    const carregarPond = rows.reduce((s, r) => s + r.carregar * r.venda, 0);
    const pisoN = rows.reduce((s, r) => s + (r.piso ? 1 : 0), 0);
    const trafegoN = rows.reduce((s, r) => s + (r.trafego ? 1 : 0), 0);
    const excedenteRs = rows.reduce((s, r) => s + (r.excedenteRs || 0), 0);
    const trafegoNomes = [];
    rows.forEach(function (r) {
      if (r.trafego && trafegoNomes.indexOf(r.n4) < 0) trafegoNomes.push(r.n4);
    });
    const perdaPct = venda
      ? (perdaAbsLida > 0 ? perdaAbsLida / venda : rows.reduce(function (s, r) { return s + (r.perdaPct || 0) * r.venda; }, 0) / venda)
      : 0;
    const perdaAbs = perdaAbsLida > 0 ? perdaAbsLida : perdaPct * venda;
    return {
      venda: venda,
      lucroValor: lucroValor,
      perdaAbs: perdaAbs,
      impacto: impacto,
      pisoN: pisoN,
      piso: pisoN > 0,
      trafegoN: trafegoN,
      excedenteRs: excedenteRs,
      trafegoNomes: trafegoNomes,
      real: venda ? lucroValor / venda : 0,
      perdaPct: perdaPct,
      proposta: venda ? propostaPond / venda : 0,
      carregar: venda ? carregarPond / venda : 0,
    };
  }

  function gapClass(gap) {
    if (gap < -0.01) return "below";
    if (gap > 0.01) return "above";
    return "ok";
  }

  function renderLojas() {
    const c = DATA.meta.clusters[state.cluster];
    const lojas = c.lojas.map((l) => l.codigo + " " + l.nome).join(" | ");
    els.lojas.innerHTML = "<strong>" + c.nome + "</strong> | " + c.criterio + " | Lojas: " + lojas;
  }

  function renderKpis() {
    const empresa = totals(allEnriched());
    const cluster = totals(allEnriched().filter((r) => r.cluster === state.cluster));
    const view = totals(clusterRows());
    const cards = [
      { lbl: "Venda do cluster", val: brl(cluster.venda), sub: "Empresa " + brl(empresa.venda) },
      { lbl: "Margem realizada", val: pct(cluster.real), sub: "Lucratividade / venda" },
      { lbl: "Margem proposta", val: pct(cluster.proposta), sub: "Perda + desp. + BO + lucro" },
      { lbl: "A carregar", val: pct(cluster.carregar), sub: view.venda !== cluster.venda ? "Recorte " + pct(view.carregar) : "Após simulação" },
      { lbl: "Gap vs realizado", val: (cluster.carregar - cluster.real >= 0 ? "+" : "") + pct(cluster.carregar - cluster.real), sub: brl(cluster.impacto), alert: cluster.carregar - cluster.real > 0.01, good: Math.abs(cluster.carregar - cluster.real) <= 0.01 },
      { lbl: "Perda / venda", val: pct(cluster.perdaPct), sub: brl(cluster.perdaAbs) },
    ];
    els.kpis.innerHTML = cards.map((c, i) =>
      '<article class="kpi ' + (c.alert ? "alert" : "") + " " + (c.good ? "good" : "") + '" style="animation-delay:' + (i * 40) + 'ms">' +
      '<div class="lbl">' + c.lbl + "</div>" +
      '<div class="val">' + c.val + "</div>" +
      '<div class="sub">' + c.sub + "</div></article>"
    ).join("");
  }

  function renderFormula() {
    const desp = state.cluster === "A" ? state.sim.despesaA : state.sim.despesaB;
    const t = totals(allEnriched().filter((r) => r.cluster === state.cluster));
    els.formula.innerHTML =
      "<span>Memória | " + DATA.meta.clusters[state.cluster].nome + "</span>" +
      "<span class='eq'>=</span>" +
      "<span>Perda <b>" + pct(t.perdaPct) + "</b></span>" +
      "<span class='eq'>+</span>" +
      "<span>Despesa loja <b>" + pct(desp) + "</b></span>" +
      "<span class='eq'>+</span>" +
      "<span>Back office <b>" + pct(state.sim.backoffice) + "</b></span>" +
      "<span class='eq'>+</span>" +
      "<span>Lucro <b>" + pct(state.sim.lucro) + "</b></span>" +
      "<span class='eq'>=</span>" +
      "<span>Margem bruta <b>" + pct(t.proposta) + "</b></span>";
    els.boNote.textContent =
      "Back office R$ " + DATA.meta.backofficeValor.toLocaleString("pt-BR") +
      " | venda empresa " + brl((metaPeriodo().vendaTotalEmpresa) || DATA.meta.vendaTotalEmpresa) +
      " = " + pct(DATA.meta.backofficePerc, 4) +
      " histórico. O percentual é o mesmo para todas as lojas; o R$ rateia pela participação na venda. Perda histórica A " + pct(PERDA_HIST.A) + " | B " + pct(PERDA_HIST.B) + ". Fluxo (Bovinos): 45% da despesa de loja e 25% do lucro. Piso: se a proposta ficar abaixo do realizado, carrega realizado + 2 p.p.; o excedente baixa o gerador de tráfego da seção (leite UHT, óleo de soja, arroz branco e feijão), sem perder competitividade.";
    const notaPerda = metaPeriodo().notaPerda;
    if (notaPerda) els.boNote.textContent += " " + notaPerda;
  }

  function renderCrumbs() {
    const bits = ['<button type="button" data-i="-1">' + DATA.meta.clusters[state.cluster].nome + "</button>"];
    state.path.forEach((p, i) => {
      bits.push('<span class="sep">/</span><button type="button" data-i="' + i + '">' + p.value + "</button>");
    });
    els.crumbs.innerHTML = bits.join("");
  }

  function titleOf(row) {
    if (row.nivel === "n1") return { name: row.n1, sub: row.n + " subgrupos" };
    if (row.nivel === "n2") return { name: row.n2, sub: row.n1 };
    if (row.nivel === "n3") return { name: row.n3, sub: row.n1 + " | " + row.n2 };
    return { name: row.n4, sub: row.n2 + " | " + row.n3 };
  }

  function esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function renderGrid() {
    const rows = clusterRows();
    const tot = totals(rows);
    const grouped = aggregate(rows, state.nivel);
    const maxVenda = grouped[0] ? grouped[0].venda : 1;
    els.body.innerHTML = grouped.map((g) => {
      const t = titleOf(g);
      const part = tot.venda ? g.venda / tot.venda : 0;
      const editable = true;
      const key = g.cluster + "|" + g.n1 + "|" + g.n2 + "|" + g.n3 + "|" + g.n4;
      const mercado = state.mercado[g.n4] || state.mercado[key];
      const mercadoTxt = mercado != null ? " | mercado " + pct(mercado) : "";
      const editado = g.alterados ? " | editado" : "";
      const pisoTxt = g.pisoN ? " | piso +2 p.p. em " + g.pisoN + " subgrupo" + (g.pisoN > 1 ? "s" : "") : "";
      const trafegoTxt = g.trafegoNomes && g.trafegoNomes.length ? " | tráfego: " + g.trafegoNomes.slice(0, 2).join(", ") : "";
      let papelCls = g.papel;
      let papelLbl = g.papel === "fluxo" ? "Fluxo" : g.papel === "lucro" ? "Giro" : g.papel === "misto" ? "Misto" : "Equilíbrio";
      if (g.nivel === "n4" && g.trafegoN && g.papel !== "fluxo") {
        papelCls = "trafego";
        papelLbl = "Tráfego";
      }
      const carregarCell = '<input class="cell-edit" type="number" step="0.05" value="' + (g.carregar * 100).toFixed(2) + '" data-key="' + esc(key) + '" />';
      return '<tr role="button" tabindex="0" data-n1="' + esc(g.n1) + '" data-n2="' + esc(g.n2) + '" data-n3="' + esc(g.n3) + '" data-n4="' + esc(g.n4) + '" data-nivel="' + g.nivel + '" data-papel="' + esc(g.papel) + '" data-key="' + esc(key) + '">' +
        "<td><div class='name'>" + esc(t.name) + editado + pisoTxt + trafegoTxt + "</div><small>" + esc(t.sub) + mercadoTxt + "</small>" +
        "<div class='bar'><i style='width:" + ((g.venda / maxVenda) * 100) + "%'></i></div></td>" +
        '<td><span class="papel ' + papelCls + '">' + papelLbl + "</span></td>" +
        '<td class="num">' + brl(g.venda) + "</td>" +
        '<td class="num">' + pct(part) + "</td>" +
        '<td class="num">' + g.unit.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "</td>" +
        '<td class="num">' + pct(g.perdaPct) + "</td>" +
        '<td class="num">' + pct(g.real) + "</td>" +
        '<td class="num">' + pct(g.proposta) + "</td>" +
        '<td class="num">' + carregarCell + "</td>" +
        '<td class="num"><span class="badge ' + gapClass(g.gap) + '">' + (g.gap >= 0 ? "+" : "") + pct(g.gap) + "</span></td>" +
        '<td class="num ' + (g.impacto < 0 ? "neg" : "pos") + '">' + brl(g.impacto) + "</td></tr>";
    }).join("");
    els.foot.textContent = grouped.length + " linhas | " + rows.length + " subgrupos | Clique para aprofundar | A carregar atualiza na hora e desce a cadeia pela venda";
  }

  function renderMemory(row) {
    if (!row) {
      els.memoryEmpty.classList.remove("hidden");
      els.memoryBody.classList.add("hidden");
      return;
    }
    const max = Math.max(row.perdaPct, row.desp, state.sim.backoffice, state.sim.lucro, 0.01);
    els.memoryEmpty.classList.add("hidden");
    els.memoryBody.classList.remove("hidden");
    const nome = row.n4 || row.n3 || row.n2 || row.n1;
    els.memoryBody.innerHTML =
      "<div><div class='waterfall'>" +
      "<div class='wf-row'><span>Perda família</span><div class='wf-bar'><i class='perda' style='width:" + ((row.perdaPct / max) * 100) + "%'></i></div><strong>" + pct(row.perdaPct) + "</strong></div>" +
      "<div class='wf-row'><span>Despesa loja</span><div class='wf-bar'><i class='desp' style='width:" + ((row.desp / max) * 100) + "%'></i></div><strong>" + pct(row.desp) + "</strong></div>" +
      "<div class='wf-row'><span>Back office</span><div class='wf-bar'><i class='bo' style='width:" + ((row.bo || state.sim.backoffice) / max * 100) + "%'></i></div><strong>" + pct(state.sim.backoffice) + "</strong></div>" +
      "<div class='wf-row'><span>Lucro líquido</span><div class='wf-bar'><i class='lucro' style='width:" + ((state.sim.lucro / max) * 100) + "%'></i></div><strong>" + pct(state.sim.lucro) + "</strong></div>" +
      "</div><div class='wf-total'><span>Margem bruta proposta</span><span>" + pct(row.proposta) + "</span></div></div>" +
      "<div class='mem-copy'><p><strong>" + esc(nome) + "</strong></p>" +
      "<p>Venda do recorte: <strong>" + brl(row.venda) + "</strong>. Margem realizada <strong>" + pct(row.real) + "</strong>. A carregar <strong>" + pct(row.carregar) + "</strong>.</p>" +
      "<p>Gap de <strong>" + pct(row.gap) + "</strong> sobre a venda gera impacto de <strong>" + brl(row.impacto) + "</strong> no resultado do cluster.</p>" +
      "<p>Fórmula: MB = perda% (família x ajuste do cluster) + despesa + back office + lucro. Gerador de fluxo recebe menos despesa/lucro; o giro compensa para o cluster continuar fechando.</p>" +
      (row.piso || row.pisoN ? "<p><strong>Piso anti-regressão:</strong> a proposta da fórmula ficaria abaixo do realizado do trimestre. Mantemos o realizado + 2 p.p. (não cortamos preço já praticado). O excedente não vai só para Bovinos: baixa o gerador de tráfego da seção ou do departamento (leite longa-vida, óleo de soja, arroz branco e feijão) para não perder competitividade. Nunca abaixo do realizado.</p>" : "") +
      (row.trafegoNomes && row.trafegoNomes.length ? "<p><strong>Tráfego da área:</strong> " + esc(row.trafegoNomes.join(", ")) + (row.excedenteRs ? ". Excedente do piso aplicado: " + brl(row.excedenteRs) : "") + ".</p>" : "") +
      (row.papel === "fluxo" ? "<p><strong>Fluxo:</strong> alto valor por unidade e pouca quantidade. Não recebe a carga cheia (caso Bovinos ~15 p.p.).</p>" : "") +
      (row.papel === "lucro" ? "<p><strong>Giro:</strong> muita quantidade e ticket menor. Pode carregar um pouco mais de margem para compensar o açougue.</p>" : "") +
      "<p>Exclusões ativas: Não revenda e sacola reciclável. Sem visão por loja nesta versão.</p></div>";
  }

  function paint(opts) {
    persist();
    renderLojas();
    renderKpis();
    renderFormula();
    renderCrumbs();
    renderGrid();
    renderSaveBtn();
    if (opts && opts.focusKey) {
      const want = opts.focusKey;
      const inp = Array.prototype.find.call(els.body.querySelectorAll(".cell-edit"), function (el) {
        return el.dataset.key === want;
      });
      if (inp) {
        inp.focus();
        if (opts.focusVal != null) inp.value = opts.focusVal;
        try { inp.select(); } catch (_) {}
      }
    }
    if (state.selected) {
      const s = state.selected;
      const rows = clusterRows().filter((r) => r.n1 === s.n1 && (!s.n2 || r.n2 === s.n2) && (!s.n3 || r.n3 === s.n3) && (!s.n4 || r.n4 === s.n4));
      const tot = totals(rows);
      state.selected = Object.assign({}, s, tot, {
        gap: tot.carregar - tot.real,
        impacto: tot.impacto,
        desp: state.cluster === "A" ? state.sim.despesaA : state.sim.despesaB,
        trafegoN: tot.trafegoN || 0,
        excedenteRs: tot.excedenteRs || 0,
        trafegoNomes: tot.trafegoNomes || [],
      });
      renderMemory(state.selected);
    }
  }

  function syncSimInputs() {
    [["simLucro", "simLucroN", "lucro"], ["simDespA", "simDespAN", "despesaA"], ["simDespB", "simDespBN", "despesaB"], ["simBO", "simBON", "backoffice"], ["simPerdaA", "simPerdaAN", "perdaA"], ["simPerdaB", "simPerdaBN", "perdaB"]].forEach(function (pair) {
      document.getElementById(pair[0]).value = state.sim[pair[2]] * 100;
      document.getElementById(pair[1]).value = (state.sim[pair[2]] * 100).toFixed(2);
    });
  }

  let simTimer = null;
  function scheduleSimPaint() {
    applySimFromInputs();
    if (simTimer) clearTimeout(simTimer);
    simTimer = setTimeout(function () { paint(); }, 80);
  }

  function applySimFromInputs() {
    [["simLucroN", "lucro"], ["simDespAN", "despesaA"], ["simDespBN", "despesaB"], ["simBON", "backoffice"], ["simPerdaAN", "perdaA"], ["simPerdaBN", "perdaB"]].forEach(function (pair) {
      const el = document.getElementById(pair[0]);
      if (!el) return;
      const v = Number(el.value);
      if (Number.isFinite(v)) state.sim[pair[1]] = v / 100;
    });
    const fluxo = document.getElementById("simFluxo");
    if (fluxo) state.sim.protegerFluxo = fluxo.checked;
    const piso = document.getElementById("simPiso");
    if (piso) state.sim.antiRegressao = piso.checked;
    const btn = document.getElementById("btnRecalc");
    if (btn) btn.classList.remove("pending");
  }

  function bindSim(idRange, idNum, key, scale) {
    scale = scale || 100;
    const range = document.getElementById(idRange);
    const num = document.getElementById(idNum);
    const set = function (v) {
      if (!Number.isFinite(v)) return;
      range.value = v;
      num.value = Number(v).toFixed(2);
      scheduleSimPaint();
    };
    range.addEventListener("input", function () { set(Number(range.value)); });
    num.addEventListener("input", function () { set(Number(num.value)); });
    num.addEventListener("change", function () { set(Number(num.value)); });
  }

  bindSim("simLucro", "simLucroN", "lucro");
  bindSim("simDespA", "simDespAN", "despesaA");
  bindSim("simDespB", "simDespBN", "despesaB");
  bindSim("simBO", "simBON", "backoffice");
  bindSim("simPerdaA", "simPerdaAN", "perdaA");
  bindSim("simPerdaB", "simPerdaBN", "perdaB");
  const btnRecalc = document.getElementById("btnRecalc");
  if (btnRecalc) {
    btnRecalc.addEventListener("click", function () {
      applySimFromInputs();
      paint();
      toast("Simulação recalculada.");
    });
  }
  const fluxoEl = document.getElementById("simFluxo");
  if (fluxoEl) {
    fluxoEl.checked = state.sim.protegerFluxo !== false;
    fluxoEl.addEventListener("change", function () {
      scheduleSimPaint();
    });
  }
  const pisoBox = document.getElementById("simPiso");
  if (pisoBox) {
    pisoBox.checked = state.sim.antiRegressao !== false;
    pisoBox.addEventListener("change", function () {
      scheduleSimPaint();
    });
  }

  document.querySelectorAll("[data-cluster]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.cluster = btn.dataset.cluster;
      state.path = [];
      state.nivel = "n1";
      els.nivel.value = "n1";
      state.selected = null;
      renderMemory(null);
      document.querySelectorAll("[data-cluster]").forEach(function (b) { b.classList.toggle("active", b === btn); });
      paint();
    });
  });

  document.querySelectorAll("[data-periodo]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.periodo = btn.dataset.periodo;
      _ativasCache = { key: "", rows: null };
      state.path = [];
      state.nivel = "n1";
      els.nivel.value = "n1";
      state.selected = null;
      renderMemory(null);
      document.querySelectorAll("[data-periodo]").forEach(function (b) { b.classList.toggle("active", b === btn); });
      applyPeriodDefaults();
      state.sim.periodo = state.periodo;
      persist();
      paint();
    });
  });

  els.nivel.addEventListener("change", function () { state.nivel = els.nivel.value; paint(); });
  els.busca.addEventListener("input", function () { state.busca = els.busca.value; paint(); });

  els.crumbs.addEventListener("click", function (e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    const i = Number(btn.dataset.i);
    state.path = i < 0 ? [] : state.path.slice(0, i + 1);
    const nextNivel = ["n1", "n2", "n3", "n4"][state.path.length] || "n4";
    state.nivel = nextNivel;
    els.nivel.value = nextNivel;
    paint();
  });

  els.body.addEventListener("click", function (e) {
    if (e.target.classList.contains("cell-edit")) {
      e.stopPropagation();
      return;
    }
    const tr = e.target.closest("tr");
    if (!tr) return;
    document.querySelectorAll(".grid tbody tr").forEach(function (r) { r.classList.remove("selected"); });
    tr.classList.add("selected");
    const rows = clusterRows().filter(function (r) {
      return r.n1 === tr.dataset.n1 && (!tr.dataset.n2 || r.n2 === tr.dataset.n2) && (!tr.dataset.n3 || r.n3 === tr.dataset.n3) && (!tr.dataset.n4 || r.n4 === tr.dataset.n4);
    });
    const t = totals(rows);
    state.selected = {
      n1: tr.dataset.n1, n2: tr.dataset.n2, n3: tr.dataset.n3, n4: tr.dataset.n4,
      venda: t.venda, real: t.real, perdaPct: t.perdaPct, proposta: t.proposta,
      carregar: t.carregar, gap: t.carregar - t.real, impacto: t.impacto,
      desp: state.cluster === "A" ? state.sim.despesaA : state.sim.despesaB,
      papel: tr.dataset.papel || "",
      pisoN: t.pisoN || 0,
      piso: !!(t.pisoN),
      trafegoN: t.trafegoN || 0,
      excedenteRs: t.excedenteRs || 0,
      trafegoNomes: t.trafegoNomes || [],
    };
    renderMemory(state.selected);
    const nivel = tr.dataset.nivel;
    if (nivel !== "n4") {
      const order = ["n1", "n2", "n3", "n4"];
      const idx = order.indexOf(nivel);
      state.path = order.slice(0, idx + 1).map(function (f) { return { field: f, value: tr.dataset[f] }; });
      const next = order[idx + 1];
      if (next) { state.nivel = next; els.nivel.value = next; paint(); }
    }
  });

  function kidsFromTr(tr) {
    return linhasAtivas().filter(function (r) {
      if (r.cluster !== state.cluster) return false;
      if (r.n1 !== tr.dataset.n1) return false;
      if (tr.dataset.n2 && r.n2 !== tr.dataset.n2) return false;
      if (tr.dataset.n3 && r.n3 !== tr.dataset.n3) return false;
      if (tr.dataset.nivel === "n4" && tr.dataset.n4 && r.n4 !== tr.dataset.n4) return false;
      return true;
    });
  }

  function applyMargemNoRecorte(tr, novaMargem) {
    const kids = kidsFromTr(tr);
    if (!kids.length || !Number.isFinite(novaMargem)) return 0;
    const atuais = {};
    allEnriched().forEach(function (r) {
      if (r.cluster === state.cluster) atuais[r.key] = r.carregar;
    });
    let venda = 0;
    let pond = 0;
    kids.forEach(function (r) {
      const k = rowKey(r);
      const base = atuais[k] != null ? atuais[k] : (r.margemReal || 0);
      venda += r.venda || 0;
      pond += base * (r.venda || 0);
    });
    const atual = venda ? pond / venda : novaMargem;
    const delta = novaMargem - atual;
    kids.forEach(function (r) {
      const k = rowKey(r);
      const base = atuais[k] != null ? atuais[k] : (r.margemReal || 0);
      state.sim.overrides[k] = Object.assign({}, state.sim.overrides[k] || {}, { margem: base + delta });
    });
    return kids.length;
  }

  let editTimer = null;
  function commitCellEdit(input) {
    const tr = input.closest("tr");
    const margem = Number(String(input.value).replace(",", ".")) / 100;
    if (!Number.isFinite(margem) || !tr) return;
    applyMargemNoRecorte(tr, margem);
    paint({ focusKey: input.dataset.key, focusVal: (margem * 100).toFixed(2) });
  }

  els.body.addEventListener("input", function (e) {
    if (!e.target.classList.contains("cell-edit")) return;
    const input = e.target;
    if (editTimer) clearTimeout(editTimer);
    editTimer = setTimeout(function () { commitCellEdit(input); }, 350);
  });

  els.body.addEventListener("change", function (e) {
    if (!e.target.classList.contains("cell-edit")) return;
    if (editTimer) clearTimeout(editTimer);
    commitCellEdit(e.target);
  });

  els.body.addEventListener("keydown", function (e) {
    if (!e.target.classList.contains("cell-edit")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (editTimer) clearTimeout(editTimer);
      commitCellEdit(e.target);
    }
  });

  document.getElementById("btnReset").addEventListener("click", function () {
    const p = metaPeriodo();
    state.sim = {
      lucro: DATA.meta.lucroAlvo,
      despesaA: (p.despesa && p.despesa.A) != null ? p.despesa.A : DATA.meta.clusters.A.despesa,
      despesaB: (p.despesa && p.despesa.B) != null ? p.despesa.B : DATA.meta.clusters.B.despesa,
      backoffice: p.backofficePerc != null ? p.backofficePerc : DATA.meta.backofficePerc,
      perdaA: PERDA_HIST.A,
      perdaB: PERDA_HIST.B,
      protegerFluxo: true,
      antiRegressao: true,
      pisoExtra: 0.02,
      pesoDespFluxo: 0.45,
      pesoLucroFluxo: 0.25,
      overrides: {},
      savedOverrides: {},
    };
    const fluxo = document.getElementById("simFluxo");
    if (fluxo) fluxo.checked = true;
    const pisoEl = document.getElementById("simPiso");
    if (pisoEl) pisoEl.checked = true;
    const recalc = document.getElementById("btnRecalc");
    if (recalc) recalc.classList.remove("pending");
    syncSimInputs();
    paint();
    toast("Simulação restaurada ao histórico do trimestre.");
  });

  document.getElementById("btnMercado").addEventListener("click", function () {
    document.getElementById("fileMercado").click();
  });

  document.getElementById("fileMercado").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const lines = String(reader.result).split(/\r?\n/).filter(Boolean);
      const map = {};
      lines.forEach(function (line, idx) {
        const parts = line.split(/[;,]/).map(function (p) { return p.trim(); });
        if (!parts.length) return;
        if (idx === 0 && /n1|subgrupo|familia|margem/i.test(parts.join(" "))) return;
        if (parts.length >= 5) {
          let perc = Number(String(parts[4]).replace("%", "").replace(",", "."));
          if (!Number.isFinite(perc)) return;
          if (perc > 1) perc = perc / 100;
          map[parts[0] + "|" + parts[1] + "|" + parts[2] + "|" + parts[3]] = perc;
          map[parts[3]] = perc;
        } else if (parts.length >= 2) {
          let perc = Number(String(parts[1]).replace("%", "").replace(",", "."));
          if (!Number.isFinite(perc)) return;
          if (perc > 1) perc = perc / 100;
          map[parts[0]] = perc;
        }
      });
      state.mercado = map;
      paint();
      toast("Faixas de mercado lidas: " + Object.keys(map).length + " chaves.");
    };
    reader.readAsText(file, "utf-8");
  });

  function toast(msg) {
    els.toast.hidden = false;
    els.toast.textContent = msg;
    setTimeout(function () { els.toast.hidden = true; }, 2800);
  }

  function xml(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function cell(v, type) {
    if (type === "n") return '<Cell ss:StyleID="num"><Data ss:Type="Number">' + v + "</Data></Cell>";
    if (type === "p") return '<Cell ss:StyleID="num"><Data ss:Type="Number">' + Number(v).toFixed(2) + "</Data></Cell>";
    return "<Cell><Data ss:Type=\"String\">" + xml(v) + "</Data></Cell>";
  }

  function sheet(name, rows) {
    return '<Worksheet ss:Name="' + xml(name) + '"><Table>' + rows.map(function (r) { return "<Row>" + r + "</Row>"; }).join("") + "</Table></Worksheet>";
  }

  function linhasExcel() {
    const saved = state.sim.savedOverrides || {};
    return allEnriched().map(function (r) {
      const ov = saved[r.key];
      const carregar = ov && ov.margem != null ? ov.margem : r.propostaCalc;
      const gap = carregar - r.real;
      return Object.assign({}, r, {
        carregar: carregar,
        gap: gap,
        impacto: gap * r.venda,
        alterado: !!(ov && ov.margem != null),
      });
    });
  }

  function exportExcel() {
    if (overridesDirty()) {
      state.sim.savedOverrides = cloneOverrides(state.sim.overrides);
      persist();
      renderSaveBtn();
    }
    const linhas = linhasExcel();
    const headerCols = ["Cluster","Departamento","Secao","Grupo","Subgrupo","Chave","Papel","Gerador_trafego","Unitario","Venda_R$","Part_cluster_pct","Perda_pct","Despesa_loja_pct","Backoffice_pct","Lucro_alvo_pct","Margem_realizada_pct","Margem_cheia_pct","Margem_proposta_pct","Margem_a_carregar_pct","Gap_pp","Impacto_R$","Excedente_piso_R$","Piso_anti_regressao","Alterado","Status"];
    const header = headerCols.map(function (h) { return '<Cell ss:StyleID="th"><Data ss:Type="String">' + h + "</Data></Cell>"; }).join("");

    function gabarito(cluster) {
      const rows = linhas.filter(function (r) { return r.cluster === cluster; });
      const tot = totals(rows);
      const body = rows.sort(function (a, b) {
        return a.n1.localeCompare(b.n1) || a.n2.localeCompare(b.n2) || a.n3.localeCompare(b.n3) || a.n4.localeCompare(b.n4);
      }).map(function (r) {
        const status = r.gap < -0.01 ? "ABAIXO" : r.gap > 0.01 ? "ACIMA" : "OK";
        return cell(r.cluster) + cell(r.n1) + cell(r.n2) + cell(r.n3) + cell(r.n4) +
          cell(r.n1 + " \\ " + r.n2 + " \\ " + r.n3 + " \\ " + r.n4) +
          cell(r.papel) +
          cell(r.trafego ? "S" : "N") +
          cell((r.unit || 0).toFixed(2), "n") +
          cell(r.venda.toFixed(2), "n") +
          cell(numPct(tot.venda ? r.venda / tot.venda : 0), "p") +
          cell(numPct(r.perdaPct), "p") +
          cell(numPct(r.desp), "p") +
          cell(numPct(state.sim.backoffice), "p") +
          cell(numPct(state.sim.lucro), "p") +
          cell(numPct(r.real), "p") +
          cell(numPct(r.propostaCheia), "p") +
          cell(numPct(r.propostaCalc), "p") +
          cell(numPct(r.carregar), "p") +
          cell(numPct(r.gap), "p") +
          cell(r.impacto.toFixed(2), "n") +
          cell((r.excedenteRs || 0).toFixed(2), "n") +
          cell(r.piso ? "S" : "N") +
          cell(r.alterado ? "S" : "N") +
          cell(status);
      });
      return [header].concat(body);
    }

    const instr = [
      cell("GABARITO DE MARGENS PARA CARGA NO ERP / INFORPRICE"),
      cell("Periodo") + cell(metaPeriodo().periodo + " | " + metaPeriodo().label),
      cell("Formula") + cell(DATA.meta.formula),
      cell("1. A aba Gabarito_ERP e a carga. Use a coluna Margem_a_carregar_pct."),
      cell("2. Percentuais estao em base 100. Ex.: 27,45 = 27,45%."),
      cell("3. Chave mercadologica = Departamento \\ Secao \\ Grupo \\ Subgrupo."),
      cell("4. Cluster A e Cluster B sao estudos separados. Nao misturar lojas."),
      cell("5. Exclusoes: Nao revenda e Sacola reciclavel."),
      cell("6. Back office rateado pela participacao na venda; entra so o %."),
      cell("8. Remarcacoes: edite A carregar e clique Salvar alteracoes (Ctrl+S). A coluna Margem_a_carregar_pct usa o valor salvo. Alterado=S. Aba Alteracoes lista o remarcado."),
      cell("7. Piso anti-regressão: se a proposta < realizado, carrega realizado + 2 p.p. O excedente baixa o gerador de tráfego da seção/departamento (leite UHT, óleo de soja, arroz branco, feijão), nunca abaixo do realizado, para não perder competitividade."),
      cell("Despesa Cluster A %") + cell(numPct(state.sim.despesaA), "n"),
      cell("Despesa Cluster B %") + cell(numPct(state.sim.despesaB), "n"),
      cell("Back office %") + cell(numPct(state.sim.backoffice), "n"),
      cell("Lucro alvo %") + cell(numPct(state.sim.lucro), "n"),
      cell("Back office R$ trimestre") + cell(DATA.meta.backofficeValor, "n"),
      cell("Venda empresa (apos exclusoes) R$") + cell(metaPeriodo().vendaTotalEmpresa || DATA.meta.vendaTotalEmpresa, "n"),
    ].map(function (row) { return row; });

        const altHeader = ["Cluster","Departamento","Secao","Grupo","Subgrupo","Venda_R$","Margem_realizada_pct","Margem_proposta_pct","Margem_salva_pct","Gap_pp"].map(function (h) { return '<Cell ss:StyleID="th"><Data ss:Type="String">' + h + "</Data></Cell>"; }).join("");
    const altBody = linhas.filter(function (r) { return r.alterado; }).sort(function (a, b) {
      return a.cluster.localeCompare(b.cluster) || a.n1.localeCompare(b.n1) || a.n2.localeCompare(b.n2) || a.n3.localeCompare(b.n3) || a.n4.localeCompare(b.n4);
    }).map(function (r) {
      return cell(r.cluster) + cell(r.n1) + cell(r.n2) + cell(r.n3) + cell(r.n4) +
        cell(r.venda.toFixed(2), "n") +
        cell(numPct(r.real), "p") +
        cell(numPct(r.propostaCalc), "p") +
        cell(numPct(r.carregar), "p") +
        cell(numPct(r.gap), "p");
    });
    const nSaved = overrideCount(state.sim.savedOverrides);

    const totA = totals(linhas.filter(function (r) { return r.cluster === "A"; }));
    const totB = totals(linhas.filter(function (r) { return r.cluster === "B"; }));
    const totE = totals(linhas);
    const confHeader = ["Visao","Venda_R$","Perda_pct","Margem_real_pct","Margem_proposta_pct","Margem_carregar_pct","Impacto_R$"]
      .map(function (h) { return '<Cell ss:StyleID="th"><Data ss:Type="String">' + h + "</Data></Cell>"; }).join("");
    function totRow(nome, t) {
      return cell(nome) + cell(t.venda.toFixed(2), "n") + cell(numPct(t.perdaPct), "p") + cell(numPct(t.real), "p") + cell(numPct(t.proposta), "p") + cell(numPct(t.carregar), "p") + cell(t.impacto.toFixed(2), "n");
    }

    const xls = '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      "<Styles><Style ss:ID=\"th\"><Font ss:Bold=\"1\" ss:Color=\"#F4EFE4\"/><Interior ss:Color=\"#1F4A38\" ss:Pattern=\"Solid\"/></Style>" +
      "<Style ss:ID=\"num\"><NumberFormat ss:Format=\"#,##0.00\"/></Style></Styles>" +
      sheet("Instrucoes", instr) +
      sheet("Gabarito_Cluster_A", gabarito("A")) +
      sheet("Gabarito_Cluster_B", gabarito("B")) +
      sheet("Alteracoes", [altHeader].concat(altBody)) +
      sheet("Conferencia", [confHeader, totRow("Cluster A", totA), totRow("Cluster B", totB), totRow("Empresa", totE)]) +
      "</Workbook>";

    const blob = new Blob([xls], { type: "application/vnd.ms-excel" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Gabarito_Margens_Inforprice_2026" + state.periodo + ".xls";
    a.click();
    URL.revokeObjectURL(a.href);
    toast(nSaved
      ? ("Excel gerado com " + nSaved + " subgrupos remarcados salvos.")
      : "Excel gerado: Gabarito_Margens_Inforprice_2026" + state.periodo + ".xls");
  }

  const btnSave = document.getElementById("btnSave");
  if (btnSave) btnSave.addEventListener("click", saveAlteracoes);
  document.getElementById("btnExcel").addEventListener("click", exportExcel);
  document.addEventListener("keydown", function (e) {
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveAlteracoes(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") { e.preventDefault(); exportExcel(); }
    if (e.key === "/" && !typing) { e.preventDefault(); els.busca.focus(); }
    if (!typing && e.key === "1") document.querySelector('[data-cluster="A"]').click();
    if (!typing && e.key === "2") document.querySelector('[data-cluster="B"]').click();
  });

  applyPeriodLabel();
  document.querySelectorAll("[data-periodo]").forEach(function (b) {
    b.classList.toggle("active", b.dataset.periodo === state.periodo);
  });
  syncSimInputs();
  paint();
})();
