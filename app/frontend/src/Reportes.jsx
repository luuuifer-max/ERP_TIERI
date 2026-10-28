import { useEffect, useState } from 'react'

const API = 'http://localhost:3000/api'
const dinero = (valor) => `Bs ${Number(valor || 0).toFixed(2)}`
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('tieri_token') || ''}` })
const hoy = new Date().toISOString().slice(0, 10)
const inicio = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)

function Barra({ valor, maximo, color = 'verde' }) {
  return <div className={`reporte-barra reporte-barra-${color}`}><span style={{ width: `${maximo ? Math.max(4, Number(valor) / maximo * 100) : 4}%` }} /></div>
}

function GraficoVentas({ serie }) {
  const [seleccion, setSeleccion] = useState(null)
  const maximo = Math.max(...serie.map((item) => Number(item.total)), 1)
  const ancho = Math.max(620, serie.length * 58)
  const puntos = serie.map((item, indice) => ({
    ...item,
    x: 34 + (indice * (ancho - 68)) / Math.max(serie.length - 1, 1),
    y: 184 - (Number(item.total) / maximo) * 142
  }))
  const linea = puntos.map((punto) => `${punto.x},${punto.y}`).join(' ')
  const area = puntos.length ? `34,184 ${linea} ${puntos[puntos.length - 1].x},184` : ''

  return <div className="reporte-svg-scroll"><div className="reporte-svg-wrap"><svg className="reporte-svg" viewBox={`0 0 ${ancho} 220`} role="img" aria-label="Ventas por período">
    <defs><linearGradient id="ventasArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#58c78a" stopOpacity=".42" /><stop offset="100%" stopColor="#58c78a" stopOpacity=".02" /></linearGradient></defs>
    {[42, 90, 138, 184].map((y) => <line key={y} x1="34" x2={ancho - 34} y1={y} y2={y} className="reporte-gridline" />)}
    {area && <polygon points={area} className="reporte-area" />}
    {linea && <polyline points={linea} className="reporte-linea" />}
    {puntos.map((punto) => <g key={punto.periodo} className="reporte-punto" onMouseEnter={() => setSeleccion(punto)} onFocus={() => setSeleccion(punto)} onMouseLeave={() => setSeleccion(null)} tabIndex="0"><circle cx={punto.x} cy={punto.y} r={seleccion?.periodo === punto.periodo ? 7 : 4} /><text x={punto.x} y="207" textAnchor="middle">{punto.periodo.slice(5)}</text></g>)}
    {seleccion && <g className="reporte-tooltip"><rect x={Math.min(Math.max(seleccion.x - 58, 4), ancho - 124)} y={Math.max(seleccion.y - 45, 4)} width="116" height="32" rx="7" /><text x={Math.min(Math.max(seleccion.x, 62), ancho - 66)} y={Math.max(seleccion.y - 25, 25)} textAnchor="middle">{seleccion.periodo} · {dinero(seleccion.total)}</text></g>}
  </svg></div></div>
}

function Reportes() {
  const [filtros, setFiltros] = useState({ desde: inicio, hasta: hoy, agrupacion: 'dia', sucursal_id: '' })
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const cargar = async () => {
    setCargando(true)
    setError('')
    try {
      const parametros = new URLSearchParams(filtros)
      const respuesta = await fetch(`${API}/reportes/ventas?${parametros}`, { headers: auth() })
      const resultado = await respuesta.json()
      if (!respuesta.ok || !resultado.ok) throw new Error(resultado.mensaje || 'No se pudo cargar el reporte')
      setDatos(resultado)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el reporte')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const cambiar = (campo, valor) => setFiltros((anterior) => ({ ...anterior, [campo]: valor }))
  const maxProducto = Math.max(...(datos?.productos || []).map((item) => Number(item.cantidad)), 1)
  const maxCategoria = Math.max(...(datos?.categorias || []).map((item) => Number(item.total)), 1)
  const maxHora = Math.max(...(datos?.horas || []).map((item) => Number(item.total)), 1)
  const horaPico = datos?.horas?.length ? datos.horas.reduce((a, b) => Number(a.total) > Number(b.total) ? a : b) : null
  const productosMenos = datos?.productos_menos || []
  const agotamiento = datos?.agotamiento || []
  const vendedoresMenos = datos?.vendedores_menos || []

  return <section className="reportes-page">
    <div className="reportes-heading"><div><span className="ventas-kicker">INTELIGENCIA DEL NEGOCIO</span><h2>Reportes de ventas</h2><p>Compara el rendimiento de tus tiendas y encuentra oportunidades de crecimiento.</p></div><button className="ventas-button ventas-button-primary" onClick={cargar}>Actualizar</button></div>
    <form className="reportes-filtros" onSubmit={(evento) => { evento.preventDefault(); cargar() }}>
      <label>Desde<input type="date" value={filtros.desde} onChange={(e) => cambiar('desde', e.target.value)} /></label>
      <label>Hasta<input type="date" value={filtros.hasta} onChange={(e) => cambiar('hasta', e.target.value)} /></label>
      <label>Ver por<select value={filtros.agrupacion} onChange={(e) => cambiar('agrupacion', e.target.value)}><option value="dia">Día</option><option value="mes">Mes</option><option value="anio">Año</option></select></label>
      <label>Sucursal<select value={filtros.sucursal_id} onChange={(e) => cambiar('sucursal_id', e.target.value)}><option value="">Todas las sucursales</option>{(datos?.opciones_sucursales || []).map((sucursal) => <option key={sucursal.id} value={sucursal.id}>{sucursal.nombre}</option>)}</select></label>
      <button className="ventas-button ventas-button-muted" disabled={cargando}>{cargando ? 'Cargando...' : 'Aplicar filtros'}</button>
    </form>
    {error && <div className="ventas-error">{error}</div>}
    {datos && <>
      <div className="reportes-kpis"><article><span>Ventas totales</span><strong>{dinero(datos.resumen.ventas)}</strong><small>En el período seleccionado</small></article><article><span>Operaciones</span><strong>{Number(datos.resumen.operaciones || 0)}</strong><small>Ventas completadas</small></article><article><span>Ticket promedio</span><strong>{dinero(datos.resumen.ticket_promedio)}</strong><small>Valor promedio por compra</small></article><article><span>Hora pico</span><strong>{horaPico ? `${String(horaPico.hora).padStart(2, '0')}:00` : '--'}</strong><small>Mayor facturación</small></article></div>
      {datos.resumen.ganancia_bruta !== undefined && <div className="reportes-ganancia"><span>Ganancia bruta del período</span><strong>{dinero(datos.resumen.ganancia_bruta)}</strong><small>{datos.resumen.detalles_sin_costo || 0} línea(s) sin costo registrado</small></div>}
      <div className="reportes-grid-principal"><section className="reporte-panel reporte-serie"><div className="reporte-panel-heading"><div><h3>Ritmo de ventas</h3><p>Pasa sobre un punto para ver el detalle exacto</p></div><span className="reporte-live">● EN VIVO</span></div>{datos.serie.length ? <GraficoVentas serie={datos.serie} /> : <div className="reportes-vacio">No hay ventas en este período.</div>}</section><section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Rendimiento por sucursal</h3><p>Comparación entre tiendas</p></div></div><div className="reporte-ranking">{datos.sucursales.map((item) => <div key={item.id}><div><strong>{item.nombre}</strong><small>{item.operaciones} operaciones</small></div><b>{dinero(item.total)}</b><Barra valor={item.total} maximo={Number(datos.sucursales[0]?.total || 1)} color="naranja" /></div>)}{!datos.sucursales.length && <div className="reportes-vacio">No hay datos.</div>}</div></section></div>
      <div className="reportes-grid-secundario"><section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Productos más vendidos</h3><p>Por unidades</p></div></div><div className="reporte-ranking">{datos.productos.map((item, index) => <div key={item.id}><div className="reporte-ranking-name"><em>{index + 1}</em><strong>{item.nombre}</strong></div><b>{item.cantidad} und.</b><Barra valor={item.cantidad} maximo={maxProducto} /></div>)}</div></section><section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Categorías</h3><p>Facturación por categoría</p></div></div><div className="reporte-ranking">{datos.categorias.map((item) => <div key={item.nombre}><div><strong>{item.nombre}</strong><small>{item.cantidad} unidades</small></div><b>{dinero(item.total)}</b><Barra valor={item.total} maximo={maxCategoria} color="azul" /></div>)}</div></section><section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Ventas por hora</h3><p>Detecta tu momento más fuerte</p></div></div><div className="reporte-ranking">{datos.horas.map((item) => <div key={item.hora}><div><strong>{String(item.hora).padStart(2, '0')}:00 - {String(Number(item.hora) + 1).padStart(2, '0')}:00</strong><small>{item.operaciones} operaciones</small></div><b>{dinero(item.total)}</b><Barra valor={item.total} maximo={maxHora} color="rojo" /></div>)}</div></section></div>
      <div className="reportes-grid-secundario"><section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Métodos de pago</h3><p>Preferencias de tus clientes</p></div></div><div className="reporte-pagos">{datos.pagos.map((item) => <div key={item.metodo}><span>{item.metodo}</span><strong>{dinero(item.total)}</strong></div>)}</div></section><section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Vendedores destacados</h3><p>Por facturación</p></div></div><div className="reporte-ranking">{datos.vendedores.map((item) => <div key={item.nombre}><div><strong>{item.nombre}</strong><small>{item.operaciones} operaciones</small></div><b>{dinero(item.total)}</b></div>)}</div></section></div>
      <div className="reportes-grid-secundario">
        <section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Productos con menor movimiento</h3><p>Menos unidades vendidas en el período</p></div></div><div className="reporte-ranking">{productosMenos.map((item) => <div key={item.id}><div><strong>{item.nombre}</strong></div><b>{item.cantidad} und.</b></div>)}{!productosMenos.length && <div className="reportes-vacio">No hay datos.</div>}</div></section>
        <section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Productos próximos a agotarse</h3><p>Estimación según las ventas del período</p></div></div><div className="reporte-ranking">{agotamiento.map((item) => <div key={item.id}><div><strong>{item.nombre}</strong><small>{item.stock_actual} unidades disponibles</small></div><b>{Number(item.dias_estimados).toFixed(1)} días</b></div>)}{!agotamiento.length && <div className="reportes-vacio">No hay productos con rotación en este período.</div>}</div></section>
        <section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Sucursales con menor facturación</h3><p>Del menor al mayor total</p></div></div><div className="reporte-ranking">{[...datos.sucursales].reverse().map((item) => <div key={item.id}><div><strong>{item.nombre}</strong><small>{item.operaciones} operaciones{item.ganancia_bruta !== undefined ? ` · Ganancia ${dinero(item.ganancia_bruta)}` : ''}</small></div><b>{dinero(item.total)}</b></div>)}</div></section>
        <section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Vendedores con menor facturación</h3><p>Del menor al mayor total</p></div></div><div className="reporte-ranking">{vendedoresMenos.map((item) => <div key={item.nombre}><div><strong>{item.nombre}</strong><small>{item.operaciones} operaciones</small></div><b>{dinero(item.total)}</b></div>)}{!vendedoresMenos.length && <div className="reportes-vacio">No hay datos.</div>}</div></section>
        <section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Formas de pago con menor uso</h3><p>Del menor al mayor total</p></div></div><div className="reporte-pagos">{[...datos.pagos].reverse().map((item) => <div key={item.metodo}><span>{item.metodo}</span><strong>{dinero(item.total)}</strong></div>)}</div></section>
      </div>
      {datos.resumen.ganancia_bruta !== undefined && <div className="reportes-grid-secundario reportes-rentabilidad">
        <section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Ganancia por sucursal</h3><p>En el período seleccionado</p></div></div><div className="reporte-ranking">{[...datos.sucursales].sort((a, b) => Number(a.ganancia_bruta) - Number(b.ganancia_bruta)).map((item) => <div key={item.id}><strong>{item.nombre}</strong><b>{dinero(item.ganancia_bruta)}</b></div>)}</div></section>
        <section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Ganancia por producto</h3><p>Más vendidos, ordenados por ganancia</p></div></div><div className="reporte-ranking">{[...datos.productos].sort((a, b) => Number(b.ganancia_bruta) - Number(a.ganancia_bruta)).map((item) => <div key={item.id}><strong>{item.nombre}</strong><b>{dinero(item.ganancia_bruta)}</b></div>)}</div></section>
        <section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Ganancia por vendedor</h3><p>En el período seleccionado</p></div></div><div className="reporte-ranking">{[...datos.vendedores].sort((a, b) => Number(a.ganancia_bruta) - Number(b.ganancia_bruta)).map((item) => <div key={item.nombre}><strong>{item.nombre}</strong><b>{dinero(item.ganancia_bruta)}</b></div>)}</div></section>
        <section className="reporte-panel"><div className="reporte-panel-heading"><div><h3>Ganancia por forma de pago</h3><p>Distribuida proporcionalmente en pagos mixtos</p></div></div><div className="reporte-pagos">{datos.pagos.map((item) => <div key={item.metodo}><span>{item.metodo}</span><strong>{dinero(item.ganancia_bruta)}</strong></div>)}</div></section>
      </div>}
    </>}
    {cargando && !datos && <div className="reportes-cargando">Preparando indicadores...</div>}
  </section>
}

export default Reportes