import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_PLATFORMS = ["Bybit P2P", "OKX P2P", "El Dorado"];
const DEFAULT_PAYMENT_METHODS = ["Mercado Pago", "Brubank", "Banco Galicia", "Lemon", "Belo"];

const STORAGE_KEYS = { platforms: "p2p_platforms", paymentMethods: "p2p_payment_methods" };

function loadFromStorage(key, defaults) {
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return [...new Set([...defaults, ...parsed])];
      }
    }
  } catch (e) {
    console.error("Error loading from storage:", e);
  }
  return [...defaults];
}
function saveToStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error("Error saving to storage:", e);
  }
}

const emptyForm = {
  fecha: new Date().toISOString().slice(0, 16),
  plataforma: "Bybit P2P",
  tipo: "Compra",
  cantidadUSDT: "",
  totalARS_Input: "",
  precioCompraARS: "",
  precioVentaARS: "",
  comisionPct: "",
  comisionEnvioUSDT: "",
  medioPagoOrigen: "",
  medioPagoDestino: "",
  notas: "",
};

// ─── FIFO ─────────────────────────────────────────────────────────────────────
function buildFifoLots(ops) {
  const lots = [];
  const sorted = [...ops].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  for (const op of sorted) {
    if (op.tipo === "Compra") {
      lots.push({ id: op.id, qty: parseFloat(op.cantidad_usdt) || 0, precio: parseFloat(op.precio_compra_ars) || 0, remaining: parseFloat(op.cantidad_usdt) || 0 });
    } else {
      let toConsume = parseFloat(op.cantidad_usdt) || 0;
      for (const lot of lots) {
        if (toConsume <= 0) break;
        const take = Math.min(toConsume, lot.remaining);
        lot.remaining -= take;
        toConsume -= take;
      }
    }
  }
  return lots;
}

function fifoCalc(lots, sellQty) {
  let remaining = sellQty;
  let totalCostARS = 0;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.remaining);
    totalCostARS += take * lot.precio;
    remaining -= take;
  }
  const consumed = sellQty - remaining;
  return { costoBasis: consumed > 0 ? totalCostARS / consumed : 0, unmetQty: remaining };
}

// ─── Calc ─────────────────────────────────────────────────────────────────────
function calcOp(cantidadUSDT, precioCompraARS, precioVentaARS, comisionPct, comisionEnvioUSDT, tipo) {
  const qty = parseFloat(cantidadUSDT) || 0;
  const pC = parseFloat(precioCompraARS) || 0;
  const pV = parseFloat(precioVentaARS) || 0;
  const comPct = parseFloat(comisionPct) || 0;
  const comEnvio = parseFloat(comisionEnvioUSDT) || 0;
  const comGenUSDT = qty * (comPct / 100);
  const totalComUSDT = comGenUSDT + comEnvio;
  const refPrice = tipo === "Compra" ? pC : pV;
  const totalComARS = totalComUSDT * refPrice;
  if (tipo === "Compra") {
    return { totalARS: qty * pC + totalComARS, totalComUSDT, totalComARS, gananciaARS: null, gananciaUSDT: null };
  }
  const gananciaARS = (pV - pC) * qty - totalComARS;
  const gananciaUSDT = pV > 0 ? gananciaARS / pV : 0;
  return { totalARS: qty * pV - totalComARS, totalComUSDT, totalComARS, gananciaARS, gananciaUSDT };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtN = (n, dec = 2) => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtARS = (n) => n == null || isNaN(n) ? "—" : `$ ${fmtN(n, 0)}`;
const fmtUSDT = (n) => n == null || isNaN(n) ? "—" : `${fmtN(n, 4)} U`;

function startOf(date, period) {
  const d = new Date(date);
  if (period === "day") { d.setHours(0, 0, 0, 0); return d; }
  if (period === "week") { d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d; }
  d.setDate(1); d.setHours(0, 0, 0, 0); return d;
}

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#141210", surface: "#1a1714", card: "#1f1c19", cardHover: "#242018",
  border: "#2e2922", borderMid: "#3d3730",
  accent: "#f97316", accentDim: "#f9731614", accentMid: "#f9731635",
  text: "#ede8e3", muted: "#6b6057", mutedMid: "#9a8f84",
  buy: "#f59e0b", buyDim: "#f59e0b18",
  sell: "#4ade80", sellDim: "#4ade8018",
  red: "#f87171", redDim: "#f8717118",
};

const inp = {
  width: "100%", background: "#0e0c0a", border: `1px solid ${C.border}`,
  borderRadius: "7px", padding: "10px 13px", color: C.text, fontSize: "13px",
  fontFamily: "inherit", transition: "border-color 0.2s",
};

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogle = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) setError(error.message);
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'JetBrains Mono', monospace" }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "40px", width: "100%", maxWidth: "400px", textAlign: "center" }}>
        <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: `linear-gradient(135deg,${C.accent},#c2410c)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", margin: "0 auto 20px" }}>₿</div>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "24px", fontWeight: 800, color: C.text, marginBottom: "6px" }}>P2P Ledger</div>
        <div style={{ fontSize: "10px", color: C.muted, letterSpacing: "0.2em", marginBottom: "32px" }}>ARBITRAJE · USDT/ARS</div>

        {error && <div style={{ fontSize: "11px", color: C.red, marginBottom: "16px" }}>{error}</div>}

        <button onClick={handleGoogle} disabled={loading} style={{
          width: "100%", background: "#fff", border: "none", color: "#1f1c19",
          padding: "13px", borderRadius: "9px", cursor: "pointer",
          fontFamily: "inherit", fontSize: "13px", fontWeight: 700,
          letterSpacing: "0.06em", display: "flex", alignItems: "center",
          justifyContent: "center", gap: "10px",
          opacity: loading ? 0.5 : 1, transition: "opacity .2s"
        }}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            <path fill="none" d="M0 0h48v48H0z"/>
          </svg>
          {loading ? "CONECTANDO…" : "INICIAR SESIÓN CON GOOGLE"}
        </button>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [ops, setOps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [platforms, setPlatforms] = useState(() => loadFromStorage(STORAGE_KEYS.platforms, DEFAULT_PLATFORMS));
  const [newPlatInput, setNewPlatInput] = useState("");
  const [showAddPlat, setShowAddPlat] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState(() => loadFromStorage(STORAGE_KEYS.paymentMethods, DEFAULT_PAYMENT_METHODS));
  const [newPaymentInput, setNewPaymentInput] = useState("");
  const [showAddPayment, setShowAddPayment] = useState(null); // null | 'origen' | 'destino'
  const [tab, setTab] = useState("registro");
  const [editId, setEditId] = useState(null);
  const [filterPlat, setFilterPlat] = useState("Todas");
  const [filterTipo, setFilterTipo] = useState("Todos");
  const [previewImg, setPreviewImg] = useState(null);
  const [fifoHint, setFifoHint] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const fileRef = useRef();

  // ── Auth ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Load ops ──
  useEffect(() => {
    if (!session) return;
    loadOps();
  }, [session]);

  const loadOps = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("operaciones")
      .select("*")
      .order("fecha", { ascending: false });
    if (!error) setOps(data || []);
    setLoading(false);
  };

  // ── FIFO autocomplete ──
  useEffect(() => {
    if (form.tipo !== "Venta" || !form.cantidadUSDT) { setFifoHint(null); return; }
    const lots = buildFifoLots(ops.filter(o => o.id !== editId));
    const result = fifoCalc(lots, parseFloat(form.cantidadUSDT) || 0);
    setFifoHint(result);
    if (result.costoBasis > 0) setForm(f => ({ ...f, precioCompraARS: result.costoBasis.toFixed(2) }));
  }, [form.tipo, form.cantidadUSDT, ops, editId]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => set("imagenUrl", ev.target.result);
    r.readAsDataURL(file);
    set("imagenNombre", file.name);
  };

  const handleSubmit = async () => {
    const pC = parseFloat(form.precioCompraARS) || 0;
    const pV = parseFloat(form.precioVentaARS) || 0;
    const comPct = parseFloat(form.comisionPct) || 0;
    const comEnvio = parseFloat(form.comisionEnvioUSDT) || 0;
    
    let qty = parseFloat(form.cantidadUSDT) || 0;
    if (form.tipo === "Compra" && form.totalARS_Input && pC > 0) {
      const tARS = parseFloat(form.totalARS_Input) || 0;
      qty = (tARS / pC - comEnvio) / (1 + comPct / 100);
    }

    if (!qty || !pC) return;
    setSaving(true);
    const calc = calcOp(qty, pC, pV, comPct, comEnvio, form.tipo);
    const record = {
      fecha: form.fecha,
      plataforma: form.plataforma,
      tipo: form.tipo,
      cantidad_usdt: qty,
      precio_compra_ars: pC,
      precio_venta_ars: pV || null,
      comision_pct: comPct || null,
      comision_envio_usdt: comEnvio || null,
      total_com_usdt: calc.totalComUSDT,
      total_com_ars: calc.totalComARS,
      total_ars: calc.totalARS,
      ganancia_ars: calc.gananciaARS,
      ganancia_usdt: calc.gananciaUSDT,
      medio_pago_origen: form.medioPagoOrigen || null,
      medio_pago_destino: form.medioPagoDestino || null,
      notas: form.notas || null,
      imagen_url: form.imagenUrl || null,
    };

    if (editId) {
      await supabase.from("operaciones").update(record).eq("id", editId);
      setEditId(null);
    } else {
      await supabase.from("operaciones").insert(record);
    }
    await loadOps();
    setForm({ ...emptyForm, plataforma: form.plataforma, comisionPct: form.comisionPct, medioPagoOrigen: form.medioPagoOrigen, medioPagoDestino: form.medioPagoDestino });
    setFifoHint(null);
    setSaving(false);
  };

  const handleEdit = (op) => {
    setForm({
      fecha: op.fecha,
      plataforma: op.plataforma,
      tipo: op.tipo,
      cantidadUSDT: op.cantidad_usdt?.toString() || "",
      totalARS_Input: op.tipo === "Compra" ? op.total_ars?.toString() || "" : "",
      precioCompraARS: op.precio_compra_ars?.toString() || "",
      precioVentaARS: op.precio_venta_ars?.toString() || "",
      comisionPct: op.comision_pct?.toString() || "",
      comisionEnvioUSDT: op.comision_envio_usdt?.toString() || "",
      medioPagoOrigen: op.medio_pago_origen || "",
      medioPagoDestino: op.medio_pago_destino || "",
      notas: op.notas || "",
      imagenUrl: op.imagen_url || null,
      imagenNombre: op.imagen_url ? "imagen guardada" : null,
    });
    setEditId(op.id);
    setTab("registro");
    window.scrollTo(0, 0);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    await supabase.from("operaciones").delete().eq("id", deleteId);
    await loadOps();
    setDeleteId(null);
  };

  const addPlatform = () => {
    const name = newPlatInput.trim();
    if (name && !platforms.includes(name)) {
      const updated = [...platforms, name];
      setPlatforms(updated);
      saveToStorage(STORAGE_KEYS.platforms, updated);
      set("plataforma", name);
    } else if (name) {
      set("plataforma", name);
    }
    setNewPlatInput("");
    setShowAddPlat(false);
  };

  const addPaymentMethod = (field) => {
    const name = newPaymentInput.trim();
    if (name && !paymentMethods.includes(name)) {
      const updated = [...paymentMethods, name];
      setPaymentMethods(updated);
      saveToStorage(STORAGE_KEYS.paymentMethods, updated);
    }
    if (name) set(field, name);
    setNewPaymentInput(""); setShowAddPayment(null);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); };

  const filtered = useMemo(() => ops.filter(o =>
    (filterPlat === "Todas" || o.plataforma === filterPlat) &&
    (filterTipo === "Todos" || o.tipo === filterTipo)
  ), [ops, filterPlat, filterTipo]);

  const stats = useMemo(() => {
    const ventas = ops.filter(o => o.tipo === "Venta");
    const compras = ops.filter(o => o.tipo === "Compra");
    const totalGananciaARS = ventas.reduce((a, o) => a + (o.ganancia_ars || 0), 0);
    const totalGananciaUSDT = ventas.reduce((a, o) => a + (o.ganancia_usdt || 0), 0);
    const totalComisionesUSDT = ops.reduce((a, o) => a + (o.total_com_usdt || 0), 0);
    const fifoLots = buildFifoLots(ops);
    const balanceUSDT = fifoLots.reduce((a, l) => a + l.remaining, 0);
    const balanceARS = ventas.reduce((a, o) => a + (o.total_ars || 0), 0) - compras.reduce((a, o) => a + (o.total_ars || 0), 0);
    const now = new Date();
    const periodoStats = {};
    for (const [key, label] of [["day", "HOY"], ["week", "ESTA SEMANA"], ["month", "ESTE MES"]]) {
      const desde = startOf(now, key);
      const opsP = ventas.filter(o => new Date(o.fecha) >= desde);
      periodoStats[key] = { label, gananciaARS: opsP.reduce((a, o) => a + (o.ganancia_ars || 0), 0), gananciaUSDT: opsP.reduce((a, o) => a + (o.ganancia_usdt || 0), 0), nOps: opsP.length };
    }
    return { totalGananciaARS, totalGananciaUSDT, totalComisionesUSDT, balanceUSDT, balanceARS, nOps: ops.length, periodoStats };
  }, [ops]);

  const preview = useMemo(() => {
    let q = parseFloat(form.cantidadUSDT) || 0;
    let pC = parseFloat(form.precioCompraARS) || 0;
    let pV = parseFloat(form.precioVentaARS) || 0;
    let comPct = parseFloat(form.comisionPct) || 0;
    let comEnvio = parseFloat(form.comisionEnvioUSDT) || 0;

    if (form.tipo === "Compra" && form.totalARS_Input && pC > 0) {
      // Si el usuario ingresa ARS, calculamos la cantidad de USDT bruta (sin comisiones)
      // totalARS = qty * pC * (1 + comPct/100) + comEnvio * pC
      // qty = (totalARS / pC - comEnvio) / (1 + comPct/100)
      const tARS = parseFloat(form.totalARS_Input) || 0;
      q = (tARS / pC - comEnvio) / (1 + comPct / 100);
    }

    return calcOp(q, pC, pV, comPct, comEnvio, form.tipo);
  }, [form]);

  const downloadCSV = (filename, csvContent) => {
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  };

  const exportCSVSeparados = () => {
    const date = new Date().toISOString().slice(0, 10);
    const compras = ops.filter(o => o.tipo === "Compra");
    const ventas = ops.filter(o => o.tipo === "Venta");

    // ── CSV Compras ──
    const hC = ["Fecha", "Cantidad USDT", "Precio Compra ARS", "Plataforma", "Total ARS", "Comision %", "Total Com.USDT", "Total Com.ARS", "Medio Pago Origen", "Medio Pago Destino", "Notas", ""];
    const rowsC = compras.map(o => [
      o.fecha,
      o.cantidad_usdt,
      o.precio_compra_ars,
      o.plataforma,
      (o.total_ars || 0).toFixed(2),
      o.comision_pct || 0,
      (o.total_com_usdt || 0).toFixed(6),
      (o.total_com_ars || 0).toFixed(2),
      o.medio_pago_origen || "",
      o.medio_pago_destino || "",
      `"${o.notas || ""}"`,
      ""
    ]);

    const totC_USDT = compras.reduce((a, o) => a + (o.cantidad_usdt || 0), 0);
    const totC_ARS = compras.reduce((a, o) => a + (o.total_ars || 0), 0);
    const totC_ComUSDT = compras.reduce((a, o) => a + (o.total_com_usdt || 0), 0);
    const totC_ComARS = compras.reduce((a, o) => a + (o.total_com_ars || 0), 0);

    const summaryC = [
      [],
      ["TOTAL USDT COMPRADOS", totC_USDT.toFixed(4), "", "", "", "", "", "", "", "", "", ""],
      ["TOTAL ARS GASTADOS", "", "", "", totC_ARS.toFixed(2), "", "", "", "", "", "", ""],
      ["TOTAL COMISIONES USDT", "", "", "", "", "", totC_ComUSDT.toFixed(6), "", "", "", "", ""],
      ["TOTAL COMISIONES ARS", "", "", "", "", "", "", totC_ComARS.toFixed(2), "", "", "", ""],
      ["TOTAL NETO (sin comisiones)", "", "", "", (totC_ARS - totC_ComARS).toFixed(2), "", "", "", "", "", "", ""],
    ];
    const csvC = [hC, ...rowsC, ...summaryC].map(r => r.join(",")).join("\n");

    // ── CSV Ventas ──
    const hV = ["Fecha", "Cantidad USDT", "Precio Costo ARS", "Precio Venta ARS", "Total ARS", "Comision %", "Total Com.USDT", "Total Com.ARS", "Medio Pago Origen", "Medio Pago Destino", "Notas", "Ganancia ARS", "Ganancia USDT"];
    const rowsV = ventas.map(o => [
      o.fecha,
      o.cantidad_usdt,
      o.precio_compra_ars,
      o.precio_venta_ars || "",
      (o.total_ars || 0).toFixed(2),
      o.comision_pct || 0,
      (o.total_com_usdt || 0).toFixed(6),
      (o.total_com_ars || 0).toFixed(2),
      o.medio_pago_origen || "",
      o.medio_pago_destino || "",
      `"${o.notas || ""}"`,
      o.ganancia_ars != null ? o.ganancia_ars.toFixed(2) : "",
      o.ganancia_usdt != null ? o.ganancia_usdt.toFixed(6) : ""
    ]);

    const totV_USDT = ventas.reduce((a, o) => a + (o.cantidad_usdt || 0), 0);
    const totV_ARS = ventas.reduce((a, o) => a + (o.total_ars || 0), 0);
    const totV_ComUSDT = ventas.reduce((a, o) => a + (o.total_com_usdt || 0), 0);
    const totV_ComARS = ventas.reduce((a, o) => a + (o.total_com_ars || 0), 0);
    const totV_GanARS = ventas.reduce((a, o) => a + (o.ganancia_ars || 0), 0);
    const totV_GanUSDT = ventas.reduce((a, o) => a + (o.ganancia_usdt || 0), 0);

    const summaryV = [
      [],
      ["TOTAL USDT VENDIDOS", totV_USDT.toFixed(4), "", "", "", "", "", "", "", "", "", ""],
      ["TOTAL ARS RECIBIDOS", "", "", "", totV_ARS.toFixed(2), "", "", "", "", "", "", ""],
      ["TOTAL COMISIONES USDT", "", "", "", "", "", totV_ComUSDT.toFixed(6), "", "", "", "", ""],
      ["TOTAL COMISIONES ARS", "", "", "", "", "", "", totV_ComARS.toFixed(2), "", "", "", ""],
      ["TOTAL GANANCIA ARS", "", "", "", "", "", "", "", "", "", totV_GanARS.toFixed(2), ""],
      ["TOTAL GANANCIA USDT", "", "", "", "", "", "", "", "", "", "", totV_GanUSDT.toFixed(6)],
    ];
    const csvV = [hV, ...rowsV, ...summaryV].map(r => r.join(",")).join("\n");

    downloadCSV(`p2p_compras_${date}.csv`, csvC);
    setTimeout(() => downloadCSV(`p2p_ventas_${date}.csv`, csvV), 300);
  };

  // ── Auth loading ──
  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontFamily: "monospace" }}>
      Cargando…
    </div>
  );

  if (!session) return <LoginScreen />;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Playfair+Display:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input,select,textarea{font-family:inherit}
        input:focus,select:focus,textarea:focus{outline:none!important;border-color:${C.accent}!important;box-shadow:0 0 0 3px ${C.accentDim}!important}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:${C.bg}}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        .rh:hover{background:${C.cardHover}!important}
        .ib{transition:opacity .15s,transform .15s}
        .ib:hover{opacity:.7!important;transform:scale(1.12)}
        .tb{transition:all .2s}
        .tb:hover{color:${C.accent}!important}
        .pb{transition:all .2s}
        @media (max-width: 768px) {
          .desktop-only { display: none !important; }
          .mobile-only { display: block !important; }
          .grid-2 { grid-template-columns: 1fr !important; }
          .header-actions { flex-direction: column; gap: 8px; width: 100%; }
          .header-actions button { width: 100%; }
        }
        @media (min-width: 769px) {
          .mobile-only { display: none !important; }
        }
      `}</style>

      {/* HEADER */}
      <div style={{ background: `linear-gradient(160deg,#1e1a16 0%,${C.bg} 100%)`, borderBottom: `1px solid ${C.border}`, padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "9px", background: `linear-gradient(135deg,${C.accent},#c2410c)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "17px", flexShrink: 0 }}>₿</div>
          <div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "19px", fontWeight: 800, letterSpacing: "-0.01em" }}>P2P Ledger</div>
            <div style={{ fontSize: "9px", color: C.muted, letterSpacing: "0.2em", marginTop: "1px" }}>ARBITRAJE · USDT/ARS</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <div style={{ fontSize: "11px", color: C.muted, padding: "6px 14px", background: C.surface, borderRadius: "6px", border: `1px solid ${C.border}` }}>
            <span style={{ color: C.accent, fontWeight: 600 }}>{stats.nOps}</span> ops · <span style={{ color: C.sell, fontWeight: 600 }}>{fmtUSDT(stats.balanceUSDT)}</span>
          </div>
          <button onClick={exportCSVSeparados} style={{ background: C.accentDim, border: `1px solid ${C.accentMid}`, color: C.accent, padding: "8px 14px", borderRadius: "7px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 600 }}>↓ CSV</button>
          <button onClick={handleLogout} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.muted, padding: "8px 14px", borderRadius: "7px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}>Salir</button>
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.surface, padding: "0 28px" }}>
        {[["registro", "✦ Registro"], ["operaciones", "≡ Operaciones"], ["resumen", "◈ Resumen"]].map(([id, label]) => (
          <button key={id} className="tb" onClick={() => setTab(id)} style={{ padding: "13px 18px", background: "transparent", border: "none", cursor: "pointer", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", fontFamily: "inherit", color: tab === id ? C.accent : C.muted, borderBottom: tab === id ? `2px solid ${C.accent}` : "2px solid transparent" }}>{label}</button>
        ))}
      </div>

      {loading && <div style={{ textAlign: "center", padding: "20px", color: C.muted, fontSize: "12px" }}>Cargando operaciones…</div>}

      <div style={{ padding: "26px 28px", maxWidth: "1120px", margin: "0 auto" }}>

        {/* ── REGISTRO ── */}
        {tab === "registro" && (
          <div style={{ maxWidth: "650px" }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "26px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "22px" }}>
                <span style={{ fontSize: "10px", color: C.accent, fontWeight: 700, letterSpacing: "0.15em" }}>{editId ? "✎ EDITANDO" : "+ NUEVA OPERACIÓN"}</span>
                {editId && <button onClick={() => { setEditId(null); setForm(emptyForm); }} style={{ fontSize: "11px", color: C.muted, background: "transparent", border: `1px solid ${C.border}`, borderRadius: "5px", padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>cancelar</button>}
              </div>

              <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
                <F label="FECHA Y HORA"><input type="datetime-local" value={form.fecha} onChange={e => set("fecha", e.target.value)} style={inp} /></F>
                <F label="PLATAFORMA">
                  <div style={{ display: "flex", gap: "6px" }}>
                    <select value={form.plataforma} onChange={e => set("plataforma", e.target.value)} style={{ ...inp, flex: 1 }}>
                      {platforms.map(p => <option key={p}>{p}</option>)}
                    </select>
                    <button onClick={() => setShowAddPlat(v => !v)} style={{ background: C.accentDim, border: `1px solid ${C.accentMid}`, color: C.accent, borderRadius: "7px", padding: "0 11px", cursor: "pointer", fontSize: "18px" }}>+</button>
                  </div>
                  {showAddPlat && (
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                      <input placeholder="Nueva plataforma…" value={newPlatInput} onChange={e => setNewPlatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addPlatform()} style={{ ...inp, flex: 1 }} />
                      <button onClick={addPlatform} style={{ background: C.accent, border: "none", color: C.bg, borderRadius: "7px", padding: "0 14px", cursor: "pointer", fontWeight: 700, fontFamily: "inherit", fontSize: "12px" }}>OK</button>
                    </div>
                  )}
                </F>
              </div>

              <div style={{ marginBottom: "14px" }}>
                <Lbl>TIPO</Lbl>
                <div style={{ display: "flex", gap: "8px" }}>
                  {["Compra", "Venta"].map(t => (
                    <button key={t} className="pb" onClick={() => set("tipo", t)} style={{ flex: 1, padding: "11px", borderRadius: "8px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 600, letterSpacing: "0.08em", background: form.tipo === t ? (t === "Compra" ? C.buyDim : C.sellDim) : "transparent", border: `1px solid ${form.tipo === t ? (t === "Compra" ? C.buy : C.sell) : C.border}`, color: form.tipo === t ? (t === "Compra" ? C.buy : C.sell) : C.muted }}>
                      {t === "Compra" ? "↓ COMPRA" : "↑ VENTA"}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: "14px" }}>
                {form.tipo === "Compra" ? (
                  <F label="CANTIDAD EN ARS (LO QUE PAGASTE)">
                    <input type="number" placeholder="0.00" value={form.totalARS_Input} onChange={e => set("totalARS_Input", e.target.value)} style={inp} />
                    {preview.totalARS > 0 && <div style={{ marginTop: "5px", fontSize: "11px", color: C.accent }}>= {fmtUSDT(preview.totalARS / (parseFloat(form.precioCompraARS) || 1))} brutos</div>}
                  </F>
                ) : (
                  <F label="CANTIDAD DE USDT (LO QUE VENDES)">
                    <input type="number" placeholder="0.00" value={form.cantidadUSDT} onChange={e => set("cantidadUSDT", e.target.value)} style={inp} />
                  </F>
                )}
              </div>

              <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
                <F label={form.tipo === "Venta" ? "COSTO FIFO ARS/USDT" : "PRECIO COMPRA ARS/USDT"}>
                  <input type="number" placeholder="0.00" value={form.precioCompraARS} onChange={e => set("precioCompraARS", e.target.value)} style={{ ...inp, borderColor: fifoHint && form.tipo === "Venta" ? C.accentMid : C.border }} />
                  {fifoHint && form.tipo === "Venta" && (
                    <div style={{ marginTop: "5px", fontSize: "10px", color: C.accent }}>
                      ↑ Autocompleto FIFO
                      {fifoHint.unmetQty > 0.001 && <span style={{ color: C.red }}> · ⚠ {fmtN(fifoHint.unmetQty, 2)} U sin lote</span>}
                    </div>
                  )}
                </F>
                <F label="PRECIO VENTA ARS/USDT">
                  <input type="number" placeholder="0.00" value={form.precioVentaARS} onChange={e => set("precioVentaARS", e.target.value)} style={inp} />
                </F>
              </div>

              <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
                <F label="COMISIÓN GENERAL (%)">
                  <input type="number" placeholder="ej: 0.20" step="0.01" value={form.comisionPct} onChange={e => set("comisionPct", e.target.value)} style={inp} />
                  {form.comisionPct && form.cantidadUSDT && <div style={{ marginTop: "5px", fontSize: "10px", color: C.mutedMid }}>= {fmtN((parseFloat(form.cantidadUSDT) * parseFloat(form.comisionPct) / 100), 4)} USDT</div>}
                </F>
                <F label="COMISIÓN ENVÍO USDT (opc.)">
                  <input type="number" placeholder="0.0000" step="0.0001" value={form.comisionEnvioUSDT} onChange={e => set("comisionEnvioUSDT", e.target.value)} style={inp} />
                </F>
              </div>

              {/* ── Medios de Pago ── */}
              <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
                <F label={form.tipo === "Compra" ? "PAGO DESDE (BANCO/WALLET)" : "ENVÍO USDT DESDE"}>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <select value={form.medioPagoOrigen} onChange={e => set("medioPagoOrigen", e.target.value)} style={{ ...inp, flex: 1 }}>
                      <option value="">— Seleccionar —</option>
                      {paymentMethods.map(p => <option key={p}>{p}</option>)}
                    </select>
                    <button onClick={() => setShowAddPayment(v => v === "origen" ? null : "origen")} style={{ background: C.accentDim, border: `1px solid ${C.accentMid}`, color: C.accent, borderRadius: "7px", padding: "0 11px", cursor: "pointer", fontSize: "18px" }}>+</button>
                  </div>
                  {showAddPayment === "origen" && (
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                      <input placeholder="Nuevo medio…" value={newPaymentInput} onChange={e => setNewPaymentInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addPaymentMethod("medioPagoOrigen")} style={{ ...inp, flex: 1 }} />
                      <button onClick={() => addPaymentMethod("medioPagoOrigen")} style={{ background: C.accent, border: "none", color: C.bg, borderRadius: "7px", padding: "0 14px", cursor: "pointer", fontWeight: 700, fontFamily: "inherit", fontSize: "12px" }}>OK</button>
                    </div>
                  )}
                </F>
                <F label={form.tipo === "Compra" ? "RECIBO USDT EN" : "RECIBO ARS EN (BANCO/WALLET)"}>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <select value={form.medioPagoDestino} onChange={e => set("medioPagoDestino", e.target.value)} style={{ ...inp, flex: 1 }}>
                      <option value="">— Seleccionar —</option>
                      {paymentMethods.map(p => <option key={p}>{p}</option>)}
                    </select>
                    <button onClick={() => setShowAddPayment(v => v === "destino" ? null : "destino")} style={{ background: C.accentDim, border: `1px solid ${C.accentMid}`, color: C.accent, borderRadius: "7px", padding: "0 11px", cursor: "pointer", fontSize: "18px" }}>+</button>
                  </div>
                  {showAddPayment === "destino" && (
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                      <input placeholder="Nuevo medio…" value={newPaymentInput} onChange={e => setNewPaymentInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addPaymentMethod("medioPagoDestino")} style={{ ...inp, flex: 1 }} />
                      <button onClick={() => addPaymentMethod("medioPagoDestino")} style={{ background: C.accent, border: "none", color: C.bg, borderRadius: "7px", padding: "0 14px", cursor: "pointer", fontWeight: 700, fontFamily: "inherit", fontSize: "12px" }}>OK</button>
                    </div>
                  )}
                </F>
              </div>

              <div style={{ marginBottom: "14px" }}>
                <Lbl>COMPROBANTE (opcional)</Lbl>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={() => fileRef.current.click()} style={{ background: C.accentDim, border: `1px dashed ${C.accentMid}`, color: C.accent, borderRadius: "7px", padding: "9px 16px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 600 }}>
                    {form.imagenNombre ? `✓ ${form.imagenNombre.slice(0, 22)}` : "↑ ADJUNTAR IMAGEN"}
                  </button>
                  {form.imagenUrl && <>
                    <button onClick={() => setPreviewImg(form.imagenUrl)} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.mutedMid, borderRadius: "7px", padding: "9px 12px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}>VER</button>
                    <button onClick={() => { set("imagenUrl", null); set("imagenNombre", null); }} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: "20px", lineHeight: 1 }}>×</button>
                  </>}
                </div>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
              </div>

              <div style={{ marginBottom: "20px" }}>
                <F label="NOTAS (opcional)">
                  <textarea value={form.notas} onChange={e => set("notas", e.target.value)} rows={2} placeholder="Contraparte, referencia, observaciones…" style={{ ...inp, resize: "vertical", lineHeight: "1.6" }} />
                </F>
              </div>

              {form.cantidadUSDT && form.precioCompraARS && (
                <div style={{ background: "#0e0c0a", border: `1px solid ${C.borderMid}`, borderRadius: "10px", padding: "16px", marginBottom: "18px" }}>
                  <div style={{ fontSize: "9px", color: C.muted, letterSpacing: "0.14em", marginBottom: "12px" }}>RESUMEN</div>
                  <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px" }}>
                    <MS label="TOTAL ARS" value={fmtARS(preview.totalARS)} color={C.text} />
                    <MS label="COMISIÓN" value={fmtUSDT(preview.totalComUSDT)} color={C.buy} />
                    {form.tipo === "Venta" && form.precioVentaARS ? <MS label="GANANCIA ARS" value={fmtARS(preview.gananciaARS)} color={preview.gananciaARS >= 0 ? C.accent : C.red} /> : <div />}
                  </div>
                  {form.tipo === "Venta" && form.precioVentaARS && (
                    <div style={{ marginTop: "10px", fontSize: "11px", fontWeight: 600, color: preview.gananciaUSDT >= 0 ? C.accent : C.red }}>
                      Ganancia USDT: {fmtUSDT(preview.gananciaUSDT)}
                    </div>
                  )}
                </div>
              )}

              <button 
                onClick={handleSubmit} 
                disabled={(form.tipo === "Compra" ? !form.totalARS_Input : !form.cantidadUSDT) || !form.precioCompraARS || saving} 
                style={{ width: "100%", background: `linear-gradient(135deg,${C.accent},#c2410c)`, border: "none", color: C.bg, padding: "13px", borderRadius: "9px", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: 700, letterSpacing: "0.08em", opacity: ((form.tipo === "Compra" ? !form.totalARS_Input : !form.cantidadUSDT) || !form.precioCompraARS || saving) ? 0.4 : 1, transition: "opacity .2s" }}
              >
                {saving ? "GUARDANDO…" : editId ? "GUARDAR CAMBIOS" : "REGISTRAR OPERACIÓN"}
              </button>
            </div>
          </div>
        )}

        {/* ── OPERACIONES ── */}
        {tab === "operaciones" && (
          <div>
            <div style={{ display: "flex", gap: "10px", marginBottom: "18px", flexWrap: "wrap", alignItems: "center" }}>
              <select value={filterPlat} onChange={e => setFilterPlat(e.target.value)} style={{ ...inp, width: "auto", padding: "8px 12px", fontSize: "11px" }}>
                <option value="Todas">Todas las plataformas</option>
                {platforms.map(p => <option key={p}>{p}</option>)}
              </select>
              <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={{ ...inp, width: "auto", padding: "8px 12px", fontSize: "11px" }}>
                <option value="Todos">Compras y Ventas</option>
                <option>Compra</option>
                <option>Venta</option>
              </select>
              <div style={{ marginLeft: "auto", fontSize: "11px", color: C.muted }}>{filtered.length} operaciones</div>
            </div>

            {filtered.length === 0
              ? <div style={{ textAlign: "center", padding: "80px 0", color: C.muted }}><div style={{ fontSize: "34px", marginBottom: "12px", opacity: 0.3 }}>◈</div><div style={{ fontSize: "13px" }}>Sin operaciones registradas</div></div>
              : (
                <>
                  <div className="desktop-only" style={{ overflowX: "auto", borderRadius: "12px", border: `1px solid ${C.border}` }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                      <thead>
                        <tr style={{ background: C.surface }}>
                          {["FECHA", "PLAT.", "TIPO", "USDT", "P.COSTO", "P.VENTA", "TOTAL ARS", "COMISIÓN", "GANANCIA ARS", "GANANCIA U", ""].map((h, i) => (
                            <th key={i} style={{ textAlign: "left", padding: "10px 13px", fontSize: "9px", color: C.muted, letterSpacing: "0.12em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((op, idx) => (
                          <tr key={op.id} className="rh" style={{ background: idx % 2 === 0 ? "transparent" : C.surface, transition: "background .15s" }}>
                            <td style={{ padding: "10px 13px", color: C.muted, whiteSpace: "nowrap", fontSize: "11px" }}>{op.fecha?.slice(0, 16).replace("T", " ")}</td>
                            <td style={{ padding: "10px 13px", fontSize: "11px" }}>{op.plataforma}</td>
                            <td style={{ padding: "10px 13px" }}>
                              <span style={{ padding: "3px 7px", borderRadius: "4px", fontSize: "9px", fontWeight: 700, background: op.tipo === "Compra" ? C.buyDim : C.sellDim, color: op.tipo === "Compra" ? C.buy : C.sell }}>
                                {op.tipo === "Compra" ? "↓ COMPRA" : "↑ VENTA"}
                              </span>
                            </td>
                            <td style={{ padding: "10px 13px", fontWeight: 600 }}>{fmtN(op.cantidad_usdt, 2)}</td>
                            <td style={{ padding: "10px 13px", color: C.mutedMid }}>{fmtARS(op.precio_compra_ars)}</td>
                            <td style={{ padding: "10px 13px", color: C.mutedMid }}>{op.precio_venta_ars ? fmtARS(op.precio_venta_ars) : "—"}</td>
                            <td style={{ padding: "10px 13px", fontWeight: 500 }}>{fmtARS(op.total_ars)}</td>
                            <td style={{ padding: "10px 13px", color: C.buy }}>{fmtUSDT(op.total_com_usdt)}</td>
                            <td style={{ padding: "10px 13px", fontWeight: 700, color: op.ganancia_ars == null ? C.muted : op.ganancia_ars >= 0 ? C.accent : C.red }}>{op.ganancia_ars != null ? fmtARS(op.ganancia_ars) : "—"}</td>
                            <td style={{ padding: "10px 13px", color: op.ganancia_usdt == null ? C.muted : op.ganancia_usdt >= 0 ? C.sell : C.red }}>{op.ganancia_usdt != null ? fmtUSDT(op.ganancia_usdt) : "—"}</td>
                            <td style={{ padding: "10px 13px" }}>
                              <div style={{ display: "flex", gap: "6px" }}>
                                {op.imagen_url && <button className="ib" onClick={() => setPreviewImg(op.imagen_url)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "14px" }}>🖼</button>}
                                <button className="ib" onClick={() => handleEdit(op)} style={{ background: "transparent", border: "none", color: C.mutedMid, cursor: "pointer", fontSize: "15px" }}>✎</button>
                                <button className="ib" onClick={() => setDeleteId(op.id)} style={{ background: "transparent", border: "none", color: C.red, cursor: "pointer", fontSize: "17px", opacity: 0.55 }}>×</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mobile-only" style={{ display: "grid", gap: "12px" }}>
                    {filtered.map(op => (
                      <div key={op.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                          <div style={{ fontSize: "11px", color: C.muted }}>{op.fecha?.slice(0, 16).replace("T", " ")} · {op.plataforma}</div>
                          <span style={{ padding: "3px 7px", borderRadius: "4px", fontSize: "9px", fontWeight: 700, background: op.tipo === "Compra" ? C.buyDim : C.sellDim, color: op.tipo === "Compra" ? C.buy : C.sell }}>
                            {op.tipo === "Compra" ? "↓ COMPRA" : "↑ VENTA"}
                          </span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                          <div><Lbl>CANTIDAD</Lbl><div style={{ fontSize: "14px", fontWeight: 700 }}>{fmtUSDT(op.cantidad_usdt)}</div></div>
                          <div><Lbl>TOTAL ARS</Lbl><div style={{ fontSize: "14px", fontWeight: 700 }}>{fmtARS(op.total_ars)}</div></div>
                          {op.tipo === "Venta" && (
                            <>
                              <div><Lbl>GANANCIA ARS</Lbl><div style={{ fontSize: "14px", fontWeight: 700, color: op.ganancia_ars >= 0 ? C.accent : C.red }}>{fmtARS(op.ganancia_ars)}</div></div>
                              <div><Lbl>GANANCIA USDT</Lbl><div style={{ fontSize: "14px", fontWeight: 700, color: op.ganancia_usdt >= 0 ? C.sell : C.red }}>{fmtUSDT(op.ganancia_usdt)}</div></div>
                            </>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: "8px", borderTop: `1px solid ${C.border}`, paddingTop: "12px", marginTop: "8px" }}>
                          {op.imagen_url && <button onClick={() => setPreviewImg(op.imagen_url)} style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: "8px", borderRadius: "6px", fontSize: "11px" }}>Imagen</button>}
                          <button onClick={() => handleEdit(op)} style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: "8px", borderRadius: "6px", fontSize: "11px" }}>Editar</button>
                          <button onClick={() => setDeleteId(op.id)} style={{ flex: 1, background: C.redDim, border: `1px solid ${C.red}`, color: C.red, padding: "8px", borderRadius: "6px", fontSize: "11px" }}>Borrar</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
          </div>
        )}

        {/* ── RESUMEN ── */}
        {tab === "resumen" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(185px,1fr))", gap: "13px", marginBottom: "26px" }}>
              <SC label="BALANCE USDT" value={fmtUSDT(stats.balanceUSDT)} color={stats.balanceUSDT >= 0 ? C.accent : C.red} sub="Stock disponible (FIFO)" />
              <SC label="FLUJO NETO ARS" value={fmtARS(stats.balanceARS)} color={stats.balanceARS >= 0 ? C.sell : C.red} sub="ARS cobrado − pagado" />
              <SC label="GANANCIA ARS" value={fmtARS(stats.totalGananciaARS)} color={stats.totalGananciaARS >= 0 ? C.accent : C.red} sub="Suma total de ventas" />
              <SC label="GANANCIA USDT" value={fmtUSDT(stats.totalGananciaUSDT)} color={stats.totalGananciaUSDT >= 0 ? C.sell : C.red} sub="Suma total de ventas" />
              <SC label="COMISIONES" value={fmtUSDT(stats.totalComisionesUSDT)} color={C.buy} sub="General + envíos" />
              <SC label="OPERACIONES" value={stats.nOps} color={C.mutedMid} sub="Total registradas" />
            </div>

            <div style={{ fontSize: "10px", color: C.muted, letterSpacing: "0.15em", marginBottom: "13px" }}>RENDIMIENTO POR PERÍODO</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "13px" }} className="grid-2">
              {Object.values(stats.periodoStats).map(p => (
                <div key={p.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "20px" }}>
                  <div style={{ fontSize: "9px", color: C.muted, letterSpacing: "0.18em", marginBottom: "14px" }}>{p.label}</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: p.gananciaARS >= 0 ? C.accent : C.red, marginBottom: "4px" }}>{fmtARS(p.gananciaARS)}</div>
                  <div style={{ fontSize: "12px", color: p.gananciaUSDT >= 0 ? C.sell : C.red, marginBottom: "12px" }}>{fmtUSDT(p.gananciaUSDT)}</div>
                  <div style={{ height: "1px", background: C.border, marginBottom: "10px" }} />
                  <div style={{ fontSize: "10px", color: C.muted }}>{p.nOps} venta{p.nOps !== 1 ? "s" : ""}</div>
                </div>
              ))}
            </div>
            {stats.nOps === 0 && <div style={{ textAlign: "center", padding: "40px", color: C.muted, fontSize: "13px" }}>Registrá tu primera operación para ver el resumen</div>}
          </div>
        )}
      </div>

      {/* MODAL ELIMINAR */}
      {deleteId && (
        <div onClick={() => setDeleteId(null)} style={{ position: "fixed", inset: 0, background: "#000000b8", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: "20px" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "30px", width: "100%", maxWidth: "400px", textAlign: "center" }}>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>⚠</div>
            <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "10px" }}>¿Confirmar eliminación?</div>
            <div style={{ fontSize: "13px", color: C.mutedMid, marginBottom: "24px", lineHeight: "1.5" }}>Esta acción es permanente. Se recalculardán automáticamente el stock FIFO y las ganancias.</div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setDeleteId(null)} style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: "12px", borderRadius: "9px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
              <button onClick={confirmDelete} style={{ flex: 1, background: C.red, border: "none", color: "#fff", padding: "12px", borderRadius: "9px", cursor: "pointer", fontWeight: 700 }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {previewImg && (
        <div onClick={() => setPreviewImg(null)} style={{ position: "fixed", inset: 0, background: "#000000b8", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "24px" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "16px", maxWidth: "92vw", maxHeight: "92vh" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
              <button onClick={() => setPreviewImg(null)} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: "22px" }}>×</button>
            </div>
            <img src={previewImg} alt="Comprobante" style={{ maxWidth: "100%", maxHeight: "78vh", borderRadius: "8px", display: "block" }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Lbl({ children }) { return <div style={{ fontSize: "9px", color: C.muted, letterSpacing: "0.16em", marginBottom: "7px", fontWeight: 600 }}>{children}</div>; }
function F({ label, children }) { return <div><Lbl>{label}</Lbl>{children}</div>; }
function MS({ label, value, color }) { return <div><div style={{ fontSize: "9px", color: C.muted, letterSpacing: "0.1em", marginBottom: "5px" }}>{label}</div><div style={{ fontSize: "14px", fontWeight: 700, color }}>{value}</div></div>; }
function SC({ label, value, color, sub }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${color}`, borderRadius: "11px", padding: "18px" }}>
      <div style={{ fontSize: "9px", color: C.muted, letterSpacing: "0.16em", marginBottom: "9px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 700, color, marginBottom: "4px" }}>{value}</div>
      {sub && <div style={{ fontSize: "10px", color: C.muted }}>{sub}</div>}
    </div>
  );
}
