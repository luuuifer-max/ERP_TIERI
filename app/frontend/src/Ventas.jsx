import { useEffect, useRef, useState } from 'react'

const API = 'http://localhost:3000/api'
const METODOS = ['EFECTIVO', 'QR', 'TARJETA', 'TRANSFERENCIA', 'OTROS']
const PAUSADAS_KEY = 'tieri_ventas_pausadas'
const RAPIDOS_KEY = 'tieri_productos_rapidos'

const dinero = (valor) => `Bs ${Number(valor || 0).toFixed(2)}`

function Ventas({ usuario }) {
  const [productos, setProductos] = useState([])
  const [carrito, setCarrito] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [impuesto, setImpuesto] = useState('0')
  const [metodo, setMetodo] = useState('EFECTIVO')
  const [recibido, setRecibido] = useState('')
  const [cliente, setCliente] = useState({ nombre: '', telefono: '' })
  const [pausadas, setPausadas] = useState(() => JSON.parse(localStorage.getItem(PAUSADAS_KEY) || '[]'))
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [ultimaVenta, setUltimaVenta] = useState(null)
  const [historial, setHistorial] = useState([])
  const [mostrarHistorial, setMostrarHistorial] = useState(false)
  const [productosRapidos, setProductosRapidos] = useState(() => JSON.parse(localStorage.getItem(RAPIDOS_KEY) || '[]'))
  const [configurandoRapidos, setConfigurandoRapidos] = useState(false)
  const [camaraAbierta, setCamaraAbierta] = useState(false)
  const [empresa, setEmpresa] = useState({ nombre: 'Tienda Tieri', direccion: '', telefono: '', logo: '' })
  const busquedaRef = useRef(null)
  const videoRef = useRef(null)

  useEffect(() => {
    const cargarProductos = async () => {
      try {
        const respuesta = await fetch(`${API}/productos`)
        const datos = await respuesta.json()
        if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudieron cargar productos')
        setProductos((datos.productos || []).filter((producto) => Number(producto.stock_actual || 0) > 0))
      } catch (err) {
        setError(err.message || 'No se pudieron cargar productos')
      } finally {
        setCargando(false)
      }
    }
    cargarProductos()
    busquedaRef.current?.focus()
  }, [])

  useEffect(() => {
    fetch(`${API}/configuracion?sucursal_id=${usuario.sucursal_id}`)
      .then((respuesta) => respuesta.json())
      .then((datos) => {
        if (datos.ok) setEmpresa((anterior) => ({ ...anterior, ...datos.configuracion }))
      })
      .catch(() => {})
  }, [usuario.sucursal_id])

  useEffect(() => {
    localStorage.setItem(PAUSADAS_KEY, JSON.stringify(pausadas))
  }, [pausadas])

  useEffect(() => {
    localStorage.setItem(RAPIDOS_KEY, JSON.stringify(productosRapidos))
  }, [productosRapidos])

  useEffect(() => {
    if (!camaraAbierta) {
      return undefined
    }

    let stream
    let activo = true
    let detector

    const iniciar = async () => {
      try {
        if (!('BarcodeDetector' in window)) {
          throw new Error('Este navegador no admite escaneo por cámara. Usa el buscador o un lector USB.')
        }

        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })

        if (!activo || !videoRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        videoRef.current.srcObject = stream
        await videoRef.current.play()
        detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e'] })

        const buscar = async () => {
          if (!activo || !videoRef.current) return
          const resultados = await detector.detect(videoRef.current)
          const codigo = resultados[0]?.rawValue

          if (codigo) {
            setBusqueda(codigo)
            setCamaraAbierta(false)
            busquedaRef.current?.focus()
            return
          }

          requestAnimationFrame(buscar)
        }

        requestAnimationFrame(buscar)
      } catch (err) {
        setError(err.message || 'No se pudo abrir la cámara')
        setCamaraAbierta(false)
      }
    }

    iniciar()

    return () => {
      activo = false
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [camaraAbierta])

  const filtrados = productos.filter((producto) => {
    const texto = busqueda.trim().toLowerCase()
    return texto && [producto.nombre, producto.codigo_interno, producto.codigo_barras, producto.marca].some((valor) => String(valor || '').toLowerCase().includes(texto))
  }).slice(0, 20)

  const productosRapidosDisponibles = productos.filter((producto) => productosRapidos.includes(producto.id))

  const subtotal = carrito.reduce((total, item) => total + item.precio * item.cantidad, 0)
  const impuestoNumero = Number(impuesto) || 0
  const total = subtotal + subtotal * impuestoNumero / 100
  const cambio = Math.max(0, Number(recibido || 0) - total)

  const limpiarVenta = () => {
    setCarrito([])
    setImpuesto('0')
    setRecibido('')
    setMetodo('EFECTIVO')
    setCliente({ nombre: '', telefono: '' })
    setError('')
    setMensaje('')
  }

  const agregarProducto = (producto) => {
    setCarrito((anterior) => {
      const existente = anterior.find((item) => item.id === producto.id)
      if (existente) {
        if (existente.cantidad >= Number(producto.stock_actual || 0)) {
          setError(`No hay más stock disponible de ${producto.nombre}`)
          return anterior
        }

        return anterior.map((item) => item.id === producto.id ? { ...item, cantidad: item.cantidad + 1 } : item)
      }
      return [...anterior, { id: producto.id, nombre: producto.nombre, codigo: producto.codigo_barras || producto.codigo_interno || '', precio: Number(producto.precio_venta_actual || 0), stock: Number(producto.stock_actual || 0), cantidad: 1 }]
    })
    setBusqueda('')
    busquedaRef.current?.focus()
  }

  const cambiarCantidad = (id, cantidad) => {
    if (cantidad <= 0) setCarrito((anterior) => anterior.filter((item) => item.id !== id))
    else setCarrito((anterior) => anterior.map((item) => item.id === id ? { ...item, cantidad: Math.min(cantidad, item.stock) } : item))
  }

  const pausarVenta = () => {
    if (!carrito.length) return
    setPausadas((anterior) => [...anterior, { id: Date.now(), fecha: new Date().toISOString(), carrito, impuesto }])
    limpiarVenta()
    setMensaje('Venta pausada correctamente')
  }

  const recuperarVenta = (venta) => {
    setCarrito(venta.carrito)
    setImpuesto(venta.impuesto)
    setPausadas((anterior) => anterior.filter((item) => item.id !== venta.id))
    setMensaje('Venta recuperada')
  }

  const imprimirTicket = () => window.print()

  const cargarHistorial = async () => {
    try {
      const respuesta = await fetch(`${API}/ventas/historial?sucursal_id=${usuario.sucursal_id}`)
      const tipo = respuesta.headers.get('content-type') || ''

      if (!tipo.includes('application/json')) {
        throw new Error('El servidor activo no tiene habilitado el historial. Reinicia el backend actualizado.')
      }

      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo cargar el historial')
      setHistorial(datos.ventas || [])
      setMostrarHistorial(true)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el historial')
    }
  }

  const devolverVenta = async (venta) => {
    const motivo = window.prompt('Escribe el motivo de la devolución:')
    if (!motivo?.trim()) return
    const respuesta = await fetch(`${API}/ventas/${venta.id}/devolucion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: usuario.id, motivo })
    })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo registrar la devolución')
    setMensaje(datos.mensaje)
    await cargarHistorial()
  }

  const verTicketHistorial = (venta) => {
    setUltimaVenta({
      ...venta,
      subtotal: Number(venta.subtotal),
      impuesto: Number(venta.impuesto),
      total: Number(venta.total),
      impuesto_porcentaje: Number(venta.impuesto_porcentaje),
      metodo_pago: venta.metodo_pago,
      monto_recibido: Number(venta.monto_pagado),
      cambio: 0,
      carrito: venta.items.map((item) => ({
        id: item.producto_id,
        nombre: item.nombre,
        precio: Number(item.precio),
        cantidad: Number(item.cantidad)
      }))
    })
  }

  const confirmarVenta = async () => {
    if (!carrito.length) return setError('Agrega al menos un producto')
    if (metodo === 'EFECTIVO' && Number(recibido || 0) < total) return setError(`El efectivo recibido debe ser al menos ${dinero(total)}`)
      if (metodo !== 'EFECTIVO' && !window.confirm(`Confirma que el pago por ${metodo} de ${dinero(total)} fue recibido.`)) return
    setGuardando(true)
    setError('')
    setMensaje('')
    try {
      const respuesta = await fetch(`${API}/ventas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario_id: usuario.id, sucursal_id: usuario.sucursal_id, cliente_nombre: cliente.nombre.trim() || null, cliente_telefono: cliente.telefono.trim() || null, items: carrito.map((item) => ({ producto_id: item.id, cantidad: item.cantidad })), metodo_pago: metodo, monto_recibido: metodo === 'EFECTIVO' ? Number(recibido) : total, impuesto_porcentaje: impuestoNumero })
      })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo registrar la venta')
      setUltimaVenta({ ...datos.venta, carrito, impuesto: impuestoNumero })
      setProductos((anterior) => anterior.map((producto) => {
        const item = carrito.find((detalle) => detalle.id === producto.id)
        return item ? { ...producto, stock_actual: Number(producto.stock_actual || 0) - item.cantidad } : producto
      }).filter((producto) => Number(producto.stock_actual || 0) > 0))
      limpiarVenta()
      setMensaje('Venta registrada correctamente')
    } catch (err) {
      setError(err.message || 'No se pudo registrar la venta')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <div className="ventas-message">Cargando punto de venta...</div>

  return (
    <section className="ventas-page">
      <div className="ventas-heading">
        <div><span className="ventas-kicker">PUNTO DE VENTA</span><h2>Nueva venta</h2><p>Usuario: {usuario.nombre} · Sucursal: {usuario.sucursal_id}</p></div>
        <div className="ventas-heading-actions"><button className="ventas-button ventas-button-muted" onClick={cargarHistorial}>Historial</button><button className="ventas-button ventas-button-muted" onClick={pausarVenta} disabled={!carrito.length}>Pausar venta</button><button className="ventas-button ventas-button-muted" onClick={() => setCamaraAbierta(true)}>Escanear con cámara</button><button className="ventas-button ventas-button-muted" onClick={() => busquedaRef.current?.focus()}>Lector / buscar</button></div>
      </div>
      {error && <div className="ventas-error">{error}</div>}
      {mensaje && <div className="ventas-success">{mensaje}</div>}
      {camaraAbierta && <div className="camara-overlay"><div className="camara-modal"><div className="ventas-section-title"><h3>Escanear producto</h3><button className="caja-close" onClick={() => setCamaraAbierta(false)}>×</button></div><video ref={videoRef} className="camara-video" muted playsInline /><p>Apunta la cámara al código de barras.</p></div></div>}
        {pausadas.length > 0 && <section className="ventas-pausadas ventas-pausadas-top"><div className="ventas-section-title"><h3>Ventas pausadas</h3><span>{pausadas.length}</span></div>{pausadas.map((venta) => <div className="venta-pausada" key={venta.id}><button onClick={() => recuperarVenta(venta)}><span>Venta de {new Date(venta.fecha).toLocaleTimeString()}</span><b>{venta.carrito.length} productos</b></button><button className="ventas-link" onClick={() => setPausadas((anterior) => anterior.filter((item) => item.id !== venta.id))}>Cancelar</button></div>)}</section>}

        <div className="ventas-layout">
        <div className="ventas-catalogo">
            <div className="ventas-rapidos-header"><div><h3>Ventas rápidas</h3><small>Productos elegidos por el vendedor</small></div><button className="ventas-link" onClick={() => setConfigurandoRapidos(!configurandoRapidos)}>{configurandoRapidos ? 'Cerrar' : 'Configurar'}</button></div>
            {configurandoRapidos && <div className="ventas-rapidos-config">{productos.map((producto) => <label key={producto.id}><input type="checkbox" checked={productosRapidos.includes(producto.id)} onChange={() => setProductosRapidos((anterior) => anterior.includes(producto.id) ? anterior.filter((id) => id !== producto.id) : [...anterior, producto.id])} />{producto.nombre}<small>Stock {producto.stock_actual}</small></label>)}</div>}
            {!configurandoRapidos && <div className="ventas-rapidos">{productosRapidosDisponibles.map((producto) => <button className="venta-producto venta-rapido" key={producto.id} onClick={() => agregarProducto(producto)}><strong>{producto.nombre}</strong><b>{dinero(producto.precio_venta_actual)}</b></button>)}{!productosRapidosDisponibles.length && <span className="ventas-empty ventas-empty-compact">Configura tus productos de mayor rotación.</span>}</div>}
          <div className="ventas-search"><span>⌕</span><input ref={busquedaRef} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && filtrados[0]) agregarProducto(filtrados[0]) }} placeholder="Buscar nombre o escanear código de barras" autoComplete="off" /></div>
          <div className="ventas-productos">{filtrados.map((producto) => <button className="venta-producto" key={producto.id} onClick={() => agregarProducto(producto)}><span><strong>{producto.nombre}</strong><small>{producto.codigo_barras || producto.codigo_interno || 'Sin código'} · Stock {Number(producto.stock_actual || 0)}</small></span><b>{dinero(producto.precio_venta_actual)}</b></button>)}{!filtrados.length && <div className="ventas-empty">Escribe un nombre o código para buscar.</div>}</div>
        </div>
        <div className="ventas-carrito"><div className="ventas-section-title"><h3>Detalle de venta</h3><button className="ventas-link" onClick={limpiarVenta} disabled={!carrito.length && !recibido}>Limpiar</button></div><div className="ventas-items">{carrito.map((item) => <div className="venta-item" key={item.id}><div><strong>{item.nombre}</strong><small>{dinero(item.precio)} c/u · Disponible {item.stock}</small></div><div className="venta-cantidad"><button onClick={() => cambiarCantidad(item.id, item.cantidad - 1)}>-</button><b>{item.cantidad}</b><button onClick={() => cambiarCantidad(item.id, item.cantidad + 1)} disabled={item.cantidad >= item.stock}>+</button></div><strong>{dinero(item.precio * item.cantidad)}</strong></div>)}{!carrito.length && <div className="ventas-empty">El carrito está vacío.</div>}</div><div className="ventas-totales"><div><span>Subtotal</span><b>{dinero(subtotal)}</b></div><label>Impuesto %<input type="number" min="0" step="0.01" value={impuesto} onChange={(e) => setImpuesto(e.target.value)} /></label><div className="ventas-total"><span>Total a cobrar</span><strong>{dinero(total)}</strong></div></div><div className="ventas-pago"><div className="ventas-cliente"><span>Cliente (opcional)</span><input maxLength="120" placeholder="Nombre" value={cliente.nombre} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} /><input maxLength="40" placeholder="Teléfono" value={cliente.telefono} onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })} /></div><label>Método de pago<select value={metodo} onChange={(e) => setMetodo(e.target.value)}>{METODOS.map((item) => <option key={item}>{item}</option>)}</select></label>{metodo === 'EFECTIVO' && <label>Efectivo recibido<input type="number" min="0" step="0.01" value={recibido} onChange={(e) => setRecibido(e.target.value)} placeholder="0.00" /></label>}<div className="ventas-cambio"><span>Cambio</span><strong>{dinero(metodo === 'EFECTIVO' ? cambio : 0)}</strong></div><button className="ventas-cobrar" onClick={confirmarVenta} disabled={guardando || !carrito.length}>{guardando ? 'Registrando...' : 'Cobrar venta'}</button></div></div>
      </div>
      {ultimaVenta && <div className="venta-ticket-overlay"><article className="venta-ticket"><div className="ticket-content">{empresa.logo && <img className="ticket-logo" src={empresa.logo} alt="Logo" />}<h2>{empresa.nombre}</h2>{empresa.direccion && <p>{empresa.direccion}</p>}{empresa.telefono && <p>{empresa.telefono}</p>}<p>Ticket de venta</p><p>Venta #{ultimaVenta.id}</p>{(ultimaVenta.cliente_nombre || ultimaVenta.cliente_telefono) && <p>Cliente: {ultimaVenta.cliente_nombre || ''} {ultimaVenta.cliente_telefono ? `· ${ultimaVenta.cliente_telefono}` : ''}</p>}<hr />{ultimaVenta.carrito.map((item) => <div className="ticket-line" key={item.id}><span>{item.cantidad} x {item.nombre}</span><b>{dinero(item.precio * item.cantidad)}</b></div>)}<hr /><div className="ticket-line"><span>Subtotal</span><b>{dinero(ultimaVenta.subtotal)}</b></div><div className="ticket-line"><span>Impuesto ({ultimaVenta.impuesto_porcentaje || 0}%)</span><b>{dinero(ultimaVenta.impuesto)}</b></div><div className="ticket-line"><span>Total</span><b>{dinero(ultimaVenta.total)}</b></div><div className="ticket-line"><span>Forma de pago</span><b>{ultimaVenta.metodo_pago}</b></div><div className="ticket-line"><span>Recibido</span><b>{dinero(ultimaVenta.monto_recibido)}</b></div><div className="ticket-line"><span>Cambio</span><b>{dinero(ultimaVenta.cambio)}</b></div><p className="ticket-thanks">Gracias por su compra</p></div><div className="ticket-actions"><button className="ventas-button ventas-button-muted" onClick={() => setUltimaVenta(null)}>Cerrar</button><button className="ventas-button ventas-button-primary" onClick={imprimirTicket}>Imprimir ticket</button></div></article></div>}
      {mostrarHistorial && <div className="venta-ticket-overlay"><article className="ventas-historial"><div className="ventas-section-title"><div><span className="ventas-kicker">CONTROL DE VENTAS</span><h3>Historial reciente</h3></div><button className="caja-close" onClick={() => setMostrarHistorial(false)}>×</button></div>{historial.map((venta) => <div className="historial-venta" key={venta.id}><div><strong>Venta #{venta.id} · {new Date(venta.fecha).toLocaleString()}</strong><small>{venta.usuario_nombre || 'Usuario'} · {venta.metodo_pago} · {venta.items.length} productos</small></div><b>{dinero(venta.total)}</b><button className="ventas-button ventas-button-muted" onClick={() => verTicketHistorial(venta)}>Ver ticket</button><button className="ventas-button ventas-button-muted" onClick={() => devolverVenta(venta)} disabled={venta.estado !== 'completada'}>{venta.estado === 'devuelta' ? 'Devuelta' : 'Devolver'}</button></div>)}{!historial.length && <div className="ventas-empty">No hay ventas registradas.</div>}</article></div>}
    </section>
  )
}

export default Ventas
