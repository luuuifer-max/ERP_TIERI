import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const API = 'http://localhost:3000/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('tieri_token') || ''}`, 'Content-Type': 'application/json' })
const dinero = (valor) => `Bs ${Number(valor || 0).toFixed(2)}`
const fechaHoy = new Date().toISOString().slice(0, 10)

function DocumentoCotizacion({ documento, usuario, editar, prepararVenta, eliminar, cerrar }) {
  const mostrarPrecios = documento.mostrar_detalle
  const imprimirCotizacion = () => {
    document.body.classList.add('tieri-print-portal')
    window.addEventListener('afterprint', () => document.body.classList.remove('tieri-print-portal'), { once: true })
    window.print()
  }
  return createPortal(
    <div className="cotizacion-overlay"><article className={`cotizacion-document ${mostrarPrecios ? '' : 'cotizacion-sin-precios'}`}><div className="cotizacion-document-actions"><button className="ventas-button ventas-button-muted" onClick={cerrar}>Cerrar</button><button className="ventas-button ventas-button-primary" onClick={imprimirCotizacion}>Imprimir</button>{!documento.convertido_venta_id && <><button className="ventas-button ventas-button-muted" onClick={() => editar(documento)}>Editar</button><button className="ventas-button ventas-button-success" onClick={() => prepararVenta(documento)}>Pasar a Ventas</button><button className="ventas-button ventas-button-muted" onClick={() => eliminar(documento)}>Eliminar</button></>}</div><div className="cotizacion-letterhead"><div className="cotizacion-brand-mark">T</div><div><h1>Tienda Tieri</h1><p>Propuesta comercial · Sucursal {documento.sucursal_nombre || usuario.sucursal_nombre || documento.sucursal_id}</p></div><div className="cotizacion-number"><span>COTIZACIÓN</span><strong>{documento.codigo}</strong><small>{new Date(documento.fecha).toLocaleDateString()}</small></div></div><div className="cotizacion-document-client"><div><span>PREPARADO PARA</span><strong>{documento.cliente_nombre || 'Cliente ocasional'}</strong><small>{documento.cliente_telefono || 'Sin teléfono registrado'}</small></div><div><span>ELABORADO POR</span><strong>{documento.usuario_nombre || usuario.nombre}</strong><small>Documento sin compromiso de compra</small></div></div><div className="cotizacion-document-table"><div><span>Producto</span><span>Cantidad</span>{mostrarPrecios && <><span>Precio</span><span>Importe</span></>}</div>{documento.items.map((item) => <div key={`${documento.id}-${item.producto_id}-${item.presentacion_id || 'b'}`}><span><strong>{item.nombre}</strong><small>{item.presentacion_nombre ? `${item.presentacion_nombre} · ` : ''}{item.codigo || 'Sin código'}</small></span><span>{item.cantidad}</span>{mostrarPrecios && <><span>{dinero(item.precio)}</span><span>{dinero(item.subtotal)}</span></>}</div>)}</div><div className="cotizacion-document-total"><span>{mostrarPrecios ? 'Subtotal' : 'Total de la propuesta'}{mostrarPrecios && <><b>{dinero(documento.subtotal)}</b><small>Descuento: {dinero(documento.descuento)}</small></>}</span><strong>{dinero(documento.total)}</strong></div>{documento.observacion && <div className="cotizacion-document-note"><span>NOTAS</span><p>{documento.observacion}</p></div>}<footer>Esta cotización no reserva inventario ni genera una venta hasta que sea convertida explícitamente.</footer></article></div>,
    document.body,
  )
}

function Cotizaciones({ usuario, onIrAVentas }) {
  const [productos, setProductos] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [carrito, setCarrito] = useState([])
  const [cliente, setCliente] = useState({ nombre: '', telefono: '' })
  const [fecha, setFecha] = useState(fechaHoy)
  const [descuento, setDescuento] = useState('0')
  const [mostrarDetalle, setMostrarDetalle] = useState(true)
  const [observacion, setObservacion] = useState('')
  const [historial, setHistorial] = useState([])
  const [buscarHistorial, setBuscarHistorial] = useState('')
  const [documento, setDocumento] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [editandoId, setEditandoId] = useState(null)

  const cargarProductos = async () => {
    const respuesta = await fetch(`${API}/productos?sucursal_id=${usuario.sucursal_id}`, { headers: auth() })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudieron cargar productos')
    setProductos(datos.productos || [])
  }

  const cargarHistorial = async (texto = buscarHistorial) => {
    const parametros = new URLSearchParams({ sucursal_id: usuario.sucursal_id, busqueda: texto })
    const respuesta = await fetch(`${API}/cotizaciones?${parametros}`, { headers: auth() })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo cargar el historial')
    setHistorial(datos.cotizaciones || [])
  }

  useEffect(() => {
    Promise.all([cargarProductos(), cargarHistorial()]).catch((err) => setError(err.message || 'No se pudo cargar Cotizaciones')).finally(() => setCargando(false))
  }, [usuario.sucursal_id])

  const filtrados = productos.filter((producto) => {
    const texto = busqueda.trim().toLowerCase()
    return texto && [producto.nombre, producto.codigo_interno, producto.codigo_barras, producto.marca, producto.categoria].some((valor) => String(valor || '').toLowerCase().includes(texto))
  }).slice(0, 8)

  const subtotal = carrito.reduce((total, item) => total + Number(item.precio) * Number(item.cantidad), 0)
  const descuentoNumero = Math.min(Math.max(Number(descuento) || 0, 0), subtotal)
  const total = subtotal - descuentoNumero

  const agregar = (producto, presentacion = null) => {
    const seleccion = presentacion || producto.presentaciones?.[0] || { id: null, nombre: producto.unidad || 'Unidad', factor: 1, precio_venta: producto.precio_venta_actual }
    const clave = `${producto.id}-${seleccion.id || 'base'}`
    setCarrito((anterior) => {
      const encontrado = anterior.find((item) => item.clave === clave)
      if (encontrado) return anterior.map((item) => item.clave === clave ? { ...item, cantidad: item.cantidad + 1 } : item)
      return [...anterior, { clave, producto_id: producto.id, nombre: producto.nombre, codigo: producto.codigo_barras || producto.codigo_interno || '', precio: Number(seleccion.precio_venta ?? producto.precio_venta_actual ?? 0), cantidad: 1, presentacion_id: seleccion.id || null, presentacion_nombre: seleccion.nombre, factor_presentacion: Number(seleccion.factor || 1) }]
    })
    setBusqueda('')
  }

  const cambiarCantidad = (clave, valor) => setCarrito((anterior) => valor <= 0 ? anterior.filter((item) => item.clave !== clave) : anterior.map((item) => item.clave === clave ? { ...item, cantidad: Math.max(1, Math.round(valor)) } : item))

  const limpiar = () => {
    setCarrito([])
    setCliente({ nombre: '', telefono: '' })
    setDescuento('0')
    setMostrarDetalle(true)
    setObservacion('')
    setFecha(fechaHoy)
    setEditandoId(null)
  }

  const guardar = async () => {
    if (!carrito.length) return setError('Agrega al menos un producto a la cotización')
    setGuardando(true)
    setError('')
    setMensaje('')
    try {
      const respuesta = await fetch(editandoId ? `${API}/cotizaciones/${editandoId}` : `${API}/cotizaciones`, { method: editandoId ? 'PUT' : 'POST', headers: auth(), body: JSON.stringify({ usuario_id: usuario.id, sucursal_id: usuario.sucursal_id, fecha, cliente_nombre: cliente.nombre, cliente_telefono: cliente.telefono, descuento: descuentoNumero, mostrar_detalle: mostrarDetalle, observacion, items: carrito }) })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo guardar la cotización')
      setDocumento(datos.cotizacion)
      setMensaje(`${datos.cotizacion.codigo} ${editandoId ? 'actualizada' : 'guardada'} correctamente`)
      limpiar()
      await cargarHistorial()
    } catch (err) {
      setError(err.message || 'No se pudo guardar la cotización')
    } finally {
      setGuardando(false)
    }
  }

  const abrirDocumento = async (id) => {
    const respuesta = await fetch(`${API}/cotizaciones/${id}`, { headers: auth() })
    const datos = await respuesta.json()
    if (respuesta.ok && datos.ok) setDocumento(datos.cotizacion)
  }

  const editar = (cotizacion) => {
    setEditandoId(cotizacion.id)
    setCliente({ nombre: cotizacion.cliente_nombre || '', telefono: cotizacion.cliente_telefono || '' })
    setFecha(new Date(cotizacion.fecha).toISOString().slice(0, 10))
    setDescuento(String(cotizacion.descuento || 0))
    setMostrarDetalle(Boolean(cotizacion.mostrar_detalle))
    setObservacion(cotizacion.observacion || '')
    setCarrito(cotizacion.items.map((item) => ({ clave: `${item.producto_id}-${item.presentacion_id || 'base'}`, producto_id: item.producto_id, nombre: item.nombre, codigo: item.codigo || '', precio: Number(item.precio), cantidad: Math.max(1, Math.round(Number(item.cantidad))), presentacion_id: item.presentacion_id || null, presentacion_nombre: item.presentacion_nombre || null, factor_presentacion: Number(item.factor_presentacion || 1) })))
    setDocumento(null)
    setMensaje(`Editando ${cotizacion.codigo}`)
  }

  const eliminar = async (cotizacion) => {
    if (!window.confirm(`¿Eliminar ${cotizacion.codigo}? Esta acción no se puede deshacer.`)) return
    const respuesta = await fetch(`${API}/cotizaciones/${cotizacion.id}`, { method: 'DELETE', headers: auth() })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return setError(datos.mensaje || 'No se pudo eliminar')
    setMensaje(`${cotizacion.codigo} eliminada`)
    setDocumento(null)
    await cargarHistorial()
  }

  const prepararVenta = (cotizacion) => {
    onIrAVentas({ ...cotizacion, items: cotizacion.items.map((item) => ({ ...item, cantidad: Math.max(1, Math.round(Number(item.cantidad))) })) })
    setDocumento(null)
  }

  const convertirVenta = prepararVenta

  if (cargando) return <div className="cotizaciones-message">Preparando Cotizaciones...</div>

  return <section className="cotizaciones-page">
    {documento && <DocumentoCotizacion documento={documento} usuario={usuario} editar={editar} prepararVenta={prepararVenta} eliminar={eliminar} cerrar={() => setDocumento(null)} />}
    <div className="cotizaciones-heading"><div><span className="ventas-kicker">DOCUMENTOS COMERCIALES</span><h2>Cotizaciones</h2><p>Prepara una propuesta profesional sin mover inventario ni registrar una venta.</p></div><div className="cotizaciones-heading-meta"><strong>{historial.length}</strong><span>cotizaciones recientes</span></div></div>
    {error && <div className="ventas-error">{error}</div>}{mensaje && <div className="ventas-success">{mensaje}</div>}
    <div className="cotizaciones-layout">
      <div className="cotizacion-editor">
        <section className="cotizacion-panel"><div className="cotizacion-panel-title"><div><span className="ventas-kicker">NUEVA PROPUESTA</span><h3>Datos del cliente</h3></div><label>Fecha<input type="date" min={fechaHoy} value={fecha} onChange={(e) => setFecha(e.target.value < fechaHoy ? fechaHoy : e.target.value)} /></label></div><div className="cotizacion-cliente"><label>Nombre o razón social<input value={cliente.nombre} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} placeholder="Cliente ocasional o empresa" /></label><label>Teléfono<input value={cliente.telefono} onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })} placeholder="Opcional" /></label></div></section>
        <section className="cotizacion-panel"><div className="cotizacion-panel-title"><div><span className="ventas-kicker">CATÁLOGO</span><h3>{editandoId ? 'Editar cotización' : 'Productos de la propuesta'}</h3></div><span className="cotizacion-count">{carrito.length} líneas</span></div><div className="cotizacion-search"><span>⌕</span><input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar producto, código o marca..." autoComplete="off" /></div>{busqueda && <div className="cotizacion-resultados">{filtrados.map((producto) => {
          const presentaciones = producto.presentaciones?.length ? producto.presentaciones : [{ id: null, nombre: producto.unidad || 'Unidad', factor: 1, precio_venta: producto.precio_venta_actual }]
          return <article className="venta-producto" key={producto.id}>
            <div className="venta-producto-info"><strong>{producto.nombre}</strong><small>{producto.codigo_barras || producto.codigo_interno || 'Sin código'} · {producto.categoria || 'Sin categoría'}</small></div>
            <div className="venta-presentaciones">{presentaciones.map((presentacion) => <button type="button" className="venta-presentacion-boton" key={presentacion.id || presentacion.nombre} onClick={() => agregar(producto, presentacion)}><strong>{presentacion.nombre}</strong><span>{dinero(presentacion.precio_venta)}</span><small>Agregar a cotización</small></button>)}</div>
          </article>
        })}{!filtrados.length && <p>No encontramos productos con esa búsqueda.</p>}</div>}<div className="cotizacion-items">{carrito.map((item) => <div className="cotizacion-item" key={item.clave}><div><strong>{item.nombre}</strong><small>{item.presentacion_nombre ? `${item.presentacion_nombre} · ` : ''}{item.codigo || 'Sin código'} · {dinero(item.precio)} c/u</small></div><div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><button type="button" className="secondary-button" onClick={() => cambiarCantidad(item.clave, item.cantidad - 1)}>-</button><input type="number" min="1" step="1" value={item.cantidad} onChange={(e) => cambiarCantidad(item.clave, Number(e.target.value))} style={{ width: '46px', textAlign: 'center' }} /><button type="button" className="secondary-button" onClick={() => cambiarCantidad(item.clave, item.cantidad + 1)}>+</button></div><b>{dinero(item.precio * item.cantidad)}</b><button type="button" onClick={() => cambiarCantidad(item.clave, 0)} aria-label={`Quitar ${item.nombre}`}>×</button></div>)}{!carrito.length && <div className="cotizacion-empty">Busca y agrega productos para armar la propuesta.</div>}</div></section>
        <section className="cotizacion-panel cotizacion-options"><label>Descuento<input type="number" min="0" step="any" value={descuento} onChange={(e) => setDescuento(e.target.value)} /></label><label className="cotizacion-switch"><input type="checkbox" checked={mostrarDetalle} onChange={(e) => setMostrarDetalle(e.target.checked)} /><span>Mostrar precios unitarios e importes</span></label><label className="cotizacion-observacion">Observación<textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Validez, condiciones o tiempos de entrega" rows="2" /></label></section>
        <div className="cotizacion-editor-actions"><button className="ventas-button ventas-button-muted" onClick={limpiar}>Limpiar</button><button className="ventas-button ventas-button-primary" onClick={guardar} disabled={guardando || !carrito.length}>{guardando ? 'Guardando...' : editandoId ? 'Actualizar cotización' : 'Guardar cotización'}</button></div>
      </div>
      <aside className="cotizaciones-history"><div className="cotizacion-panel-title"><div><span className="ventas-kicker">RESPALDO</span><h3>Historial</h3></div><span className="cotizacion-count">{historial.length}</span></div><div className="cotizacion-history-search"><input value={buscarHistorial} onChange={(e) => setBuscarHistorial(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && cargarHistorial()} placeholder="Código o cliente..." /><button onClick={() => cargarHistorial()}>Buscar</button></div><div className="cotizacion-history-list">{historial.map((item) => <div className="cotizacion-history-item" key={item.id}><button style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', border: 0, background: 'transparent', textAlign: 'left' }} onClick={() => abrirDocumento(item.id)}><div><strong>{item.codigo}</strong><small>{new Date(item.fecha).toLocaleDateString()} · {item.cliente_nombre || 'Sin cliente'}</small><small>{item.usuario_nombre || 'Usuario'} · {item.cantidad_items} líneas</small></div><b>{dinero(item.total)}</b></button>{item.estado === 'vigente' && <button type="button" title="Eliminar" onClick={() => eliminar(item)} style={{ border: 0, background: 'transparent', color: '#bb5b4e', fontSize: '16px', padding: '0 6px' }}>×</button>}</div>)}{!historial.length && <div className="cotizacion-empty">Aún no hay cotizaciones.</div>}</div></aside>
    </div>
  </section>
}

export default Cotizaciones