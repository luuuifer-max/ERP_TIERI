import { useEffect, useRef, useState } from 'react'

const API = 'http://localhost:3000/api'
const METODOS = ['EFECTIVO', 'QR', 'TARJETA', 'TRANSFERENCIA', 'OTROS']
const PAUSADAS_KEY = 'tieri_ventas_pausadas'
const RAPIDOS_KEY = 'tieri_productos_rapidos'

const dinero = (valor) => `Bs ${Number(valor || 0).toFixed(2)}`
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('tieri_token') || ''}`, 'Content-Type': 'application/json' })

function Ventas({ usuario, ventaInicial, onVentaInicialCargada }) {
  const [productos, setProductos] = useState([])
  const [carrito, setCarrito] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [impuesto, setImpuesto] = useState('0')
  const [descuento, setDescuento] = useState('0')
  const [metodo, setMetodo] = useState('EFECTIVO')
  const [recibido, setRecibido] = useState('')
  const [cliente, setCliente] = useState({ nombre: '', telefono: '' })
  const [clientesRegistrados, setClientesRegistrados] = useState([])
  const [clienteBusqueda, setClienteBusqueda] = useState('')
  const [sinStock, setSinStock] = useState([])

  useEffect(() => {
    fetch(`${API}/clientes/lista-ventas`, { headers: auth() })
      .then((respuesta) => respuesta.json())
      .then((datos) => { if (datos.ok) setClientesRegistrados(datos.clientes || []) })
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!cliente.nombre && !cliente.telefono) setClienteBusqueda('')
  }, [cliente])
  const guardarClienteDesdeVenta = async () => {
    if (!cliente.nombre.trim()) return setError('Escribe el nombre del cliente para registrarlo')
    try {
      const respuesta = await fetch(`${API}/clientes`, { method: 'POST', headers: auth(), body: JSON.stringify({ nombre: cliente.nombre, telefono: cliente.telefono }) })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo registrar el cliente')
      const lista = await (await fetch(`${API}/clientes/lista-ventas`, { headers: auth() })).json()
      if (lista.ok) setClientesRegistrados(lista.clientes || [])
      setMensaje('Cliente registrado en el módulo Clientes')
    } catch (err) {
      setError(err.message || 'No se pudo registrar el cliente')
    }
  }
  const etiquetaCliente = (c) => (c.telefono ? `${c.nombre} · ${c.telefono}` : c.nombre)
  const elegirCliente = (texto) => {
    setClienteBusqueda(texto)
    const elegido = clientesRegistrados.find((c) => etiquetaCliente(c) === texto)
    if (elegido) setCliente({ nombre: elegido.nombre, telefono: elegido.telefono || '' })
  }
  const clienteRegistrado = clientesRegistrados.some((c) => (c.telefono && c.telefono === cliente.telefono.trim()) || (cliente.nombre.trim() && c.nombre.trim().toLowerCase() === cliente.nombre.trim().toLowerCase()))
  const [pausadas, setPausadas] = useState(() => JSON.parse(localStorage.getItem(PAUSADAS_KEY) || '[]'))
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [ultimaVenta, setUltimaVenta] = useState(null)
  const [historial, setHistorial] = useState([])
  const [mostrarHistorial, setMostrarHistorial] = useState(false)
  const [devolucionEditando, setDevolucionEditando] = useState(null)
  const [motivoDevolucion, setMotivoDevolucion] = useState('')
  const [lineasDevolucion, setLineasDevolucion] = useState([])
  const [guardandoDevolucion, setGuardandoDevolucion] = useState(false)
  const [ticketDevolucion, setTicketDevolucion] = useState(null)
  const [productosRapidos, setProductosRapidos] = useState(() => JSON.parse(localStorage.getItem(RAPIDOS_KEY) || '[]'))
  const [configurandoRapidos, setConfigurandoRapidos] = useState(false)
  const [camaraAbierta, setCamaraAbierta] = useState(false)
  useEffect(() => {
    fetch(`${API}/productos?sucursal_id=${usuario.sucursal_id}`, { headers: auth() })
      .then((respuesta) => respuesta.json())
      .then((datos) => { if (datos.ok) setSinStock((datos.productos || []).filter((producto) => Number(producto.stock_actual || 0) <= 0)) })
      .catch(() => {})
  }, [usuario.sucursal_id, camaraAbierta])
  const [empresa, setEmpresa] = useState({ nombre: 'Tienda Tieri', direccion: '', telefono: '', logo: '' })
  const busquedaRef = useRef(null)
  const videoRef = useRef(null)
  const puedeAutorizarDescuento = [1, '1'].includes(usuario?.rol_id) || ['dueño', 'dueno', 'jefe', 'supervisor', 'gerente', 'gerente general'].includes(String(usuario?.rol || '').toLowerCase())

  useEffect(() => {
    const cargarProductos = async () => {
      try {
        const respuesta = await fetch(`${API}/productos?sucursal_id=${usuario.sucursal_id}`, { headers: auth() })
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
  }, [usuario.sucursal_id])

  useEffect(() => {
    if (!ventaInicial?.items?.length || cargando) return
    setCarrito(ventaInicial.items.map((item) => {
      const producto = productos.find((p) => p.id === item.producto_id)
      const presentacion = producto?.presentaciones?.find((p) => item.presentacion_id && p.id === Number(item.presentacion_id)) || producto?.presentaciones?.find((p) => item.presentacion_nombre && p.nombre === item.presentacion_nombre) || null
      const factor = Number(presentacion?.factor || item.factor_presentacion || 1)
      return { id: item.producto_id, clave: `${item.producto_id}-${presentacion?.id || 'base'}`, nombre: item.nombre, codigo: item.codigo || '', precio: Number(item.precio), stock: Number(item.stock_actual ?? producto?.stock_actual ?? 0), cantidad: Math.max(1, Math.round(Number(item.cantidad))), presentacion_id: presentacion?.id || null, presentacion_nombre: presentacion?.nombre || item.presentacion_nombre || producto?.unidad || 'Unidad', factor }
    }))
    setCliente({ nombre: ventaInicial.cliente_nombre || '', telefono: ventaInicial.cliente_telefono || '' })
    setDescuento(String(ventaInicial.descuento || 0))
    setMensaje(`Cotización ${ventaInicial.codigo} cargada. Verifica existencias y cobra cuando corresponda.`)
    onVentaInicialCargada?.()
  }, [ventaInicial, productos, cargando])

  useEffect(() => {
    fetch(`${API}/configuracion?sucursal_id=${usuario.sucursal_id}`, { headers: auth() })
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

  const filtradosSinStock = busqueda.trim() ? sinStock.filter((producto) => [producto.nombre, producto.codigo_interno, producto.codigo_barras, producto.marca].some((valor) => String(valor || '').toLowerCase().includes(busqueda.trim().toLowerCase()))).slice(0, 8) : []

  const productosRapidosDisponibles = productos.filter((producto) => productosRapidos.includes(producto.id))

  const subtotal = carrito.reduce((total, item) => total + item.precio * item.cantidad, 0)
  const descuentoNumero = Math.min(Math.max(Number(descuento) || 0, 0), subtotal)
  const impuestoNumero = Number(impuesto) || 0
  const totalNeto = subtotal - descuentoNumero
  const total = totalNeto + totalNeto * impuestoNumero / 100
  const cambio = Math.max(0, Number(recibido || 0) - total)

  const limpiarVenta = () => {
    setCarrito([])
    setImpuesto('0')
    setDescuento('0')
    setRecibido('')
    setMetodo('EFECTIVO')
    setCliente({ nombre: '', telefono: '' })
    setError('')
    setMensaje('')
  }

  const agregarProducto = (producto, presentacion = null) => {
    const seleccion = presentacion || { id: null, nombre: producto.unidad || 'Unidad', factor: 1, precio_venta: producto.precio_venta_actual }
    const factor = Number(seleccion.factor || 1)
    const clave = `${producto.id}-${seleccion.id || 'base'}`
    setCarrito((anterior) => {
      const existente = anterior.find((item) => item.clave === clave)
      const unidadesEnCarrito = anterior.filter((item) => item.id === producto.id).reduce((total, item) => total + item.cantidad * Number(item.factor || 1), 0)
      if (unidadesEnCarrito + factor > Number(producto.stock_actual || 0)) {
        setError(`No hay suficiente stock disponible de ${producto.nombre}`)
        return anterior
      }
      if (existente) {
        return anterior.map((item) => item.clave === clave ? { ...item, cantidad: Number(item.cantidad || 0) + 1 } : item)
      }
      return [...anterior, { id: producto.id, clave, nombre: producto.nombre, codigo: producto.codigo_barras || producto.codigo_interno || '', precio: Number(seleccion.precio_venta || 0), stock: Number(producto.stock_actual || 0), cantidad: 1, presentacion_id: seleccion.id, presentacion_nombre: seleccion.nombre, factor }]
    })
    setBusqueda('')
    busquedaRef.current?.focus()
  }

  const cambiarCantidad = (clave, cantidad) => {
    if (cantidad === '') {
      setCarrito((anterior) => anterior.map((item) => item.clave === clave ? { ...item, cantidad: '' } : item))
    } else if (!Number.isInteger(Number(cantidad))) return
    else if (Number(cantidad) <= 0) setCarrito((anterior) => anterior.filter((item) => item.clave !== clave))
    else {
      const linea = carrito.find((item) => item.clave === clave)
      if (!linea) return
      const unidadesOtrasLineas = carrito.filter((item) => item.id === linea.id && item.clave !== clave).reduce((total, item) => total + item.cantidad * Number(item.factor || 1), 0)
      const cantidadMaxima = Math.floor(Math.max(0, Number(linea.stock) - unidadesOtrasLineas) / Number(linea.factor || 1))
      if (Number(cantidad) > cantidadMaxima) {
        setError(`Solicitaste ${cantidad} ${linea.presentacion_nombre || 'unidades'} de ${linea.nombre}, pero solo hay ${cantidadMaxima} disponibles. Se ajustó la cantidad a ${cantidadMaxima}.`)
      } else {
        setError((anterior) => anterior.startsWith('Solicitaste ') ? '' : anterior)
      }
      setCarrito((anterior) => anterior.map((item) => item.clave === clave ? { ...item, cantidad: Math.min(Number(cantidad), cantidadMaxima) } : item))
    }
  }

  useEffect(() => {
    const cantidades = document.querySelectorAll('.venta-cantidad b')
    cantidades.forEach((cantidad) => {
      cantidad.contentEditable = 'true'
      cantidad.inputMode = 'numeric'
      cantidad.setAttribute('role', 'textbox')
      cantidad.setAttribute('aria-label', 'Editar cantidad')
    })
    const obtenerLinea = (cantidad) => {
      const fila = cantidad.closest('.venta-item')
      const filas = Array.from(fila?.parentElement?.querySelectorAll('.venta-item') || [])
      return carrito[filas.indexOf(fila)]
    }
    const validarEdicion = (evento) => {
      const cantidad = evento.target.closest?.('.venta-cantidad b')
      if (cantidad && !/^\d*$/.test(cantidad.textContent.trim())) {
        const linea = obtenerLinea(cantidad)
        if (linea) cantidad.textContent = String(linea.cantidad)
      }
    }
    const seleccionarCantidad = (evento) => {
      const cantidad = evento.target.closest?.('.venta-cantidad b')
      if (!cantidad) return
      const rango = document.createRange()
      rango.selectNodeContents(cantidad)
      const seleccion = window.getSelection()
      seleccion?.removeAllRanges()
      seleccion?.addRange(rango)
    }
    const confirmarEdicion = (evento) => {
      const cantidad = evento.target.closest?.('.venta-cantidad b')
      if (!cantidad) return
      const linea = obtenerLinea(cantidad)
      if (!linea) return
      const valor = cantidad.textContent.trim()
      cambiarCantidad(linea.clave, valor || '1')
    }
    document.addEventListener('input', validarEdicion)
    document.addEventListener('focusin', seleccionarCantidad)
    document.addEventListener('focusout', confirmarEdicion)
    return () => {
      document.removeEventListener('input', validarEdicion)
      document.removeEventListener('focusin', seleccionarCantidad)
      document.removeEventListener('focusout', confirmarEdicion)
    }
  }, [carrito])

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

  const imprimirTicket = () => {
    const configurado = localStorage.getItem(`tieri_ancho_ticket_${usuario.sucursal_id}`)
    const valor = configurado === '80' ? 80 : 58
    document.body.classList.add('tieri-print-inline')
    document.body.style.setProperty('--ticket-print-width', `${valor}mm`)
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('tieri-print-inline')
      document.body.style.removeProperty('--ticket-print-width')
    }, { once: true })
    window.print()
  }

  const renderTarjetaProducto = (producto, rapido = false) => {
    const presentaciones = producto.presentaciones?.length ? producto.presentaciones : [{ id: null, nombre: producto.unidad || 'Unidad', factor: 1, precio_venta: producto.precio_venta_actual }]
    const stock = Number(producto.stock_actual || 0)
    let restante = stock
    const desgloseStock = [...presentaciones].sort((a, b) => Number(b.factor) - Number(a.factor)).flatMap((presentacion) => {
      const factor = Number(presentacion.factor) || 1
      const cantidad = Math.floor(restante / factor)
      restante -= cantidad * factor
      return cantidad > 0 ? [`${cantidad} ${presentacion.nombre}`] : []
    })
    const resumenStock = desgloseStock.length ? desgloseStock.join(' + ') : `0 ${producto.unidad || 'unidades'}`
    const puedeAbrirPresentacion = presentaciones.some((presentacion) => Number(presentacion.factor) > 1 && Number(presentacion.factor) <= stock)
    return <article className={`venta-producto${rapido ? ' venta-producto-rapido' : ''}`} key={producto.id}>
      <div className="venta-producto-info"><strong>{producto.nombre}</strong><small>{rapido ? `Stock ${resumenStock}` : `${producto.codigo_barras || producto.codigo_interno || 'Sin código'} · Stock ${resumenStock}`}</small></div>
      <div className="venta-presentaciones">
        {presentaciones.map((presentacion) => {
          const factor = Number(presentacion.factor || 1)
          return <button key={presentacion.id || presentacion.nombre} type="button" className="venta-presentacion-boton" onClick={() => agregarProducto(producto, presentacion)} disabled={factor > stock}>
            <strong>{presentacion.nombre}</strong><span>{dinero(presentacion.precio_venta)}</span><small>{Math.floor(stock / factor)} disponibles{factor === 1 && puedeAbrirPresentacion ? ' · incluye cajas' : ''}</small>
          </button>
        })}
      </div>
    </article>
  }

  const cargarHistorial = async () => {
    try {
      const respuesta = await fetch(`${API}/ventas/historial?sucursal_id=${usuario.sucursal_id}`, { headers: auth() })
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
    try {
      const respuesta = await fetch(`${API}/ventas/${venta.id}/devolucion`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ motivo, tipo: 'total' })
      })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo registrar la devolución')
      setMensaje(datos.mensaje)
      setTicketDevolucion(datos.devolucion)
      cargarHistorial()
    } catch (err) {
      setError(err.message || 'No se pudo registrar la devolución')
    }
  }

  const abrirDevolucionParcial = (venta) => {
    setDevolucionEditando(venta)
    setMotivoDevolucion('')
    setLineasDevolucion(venta.items.map((item) => ({
      detalle_venta_id: item.detalle_venta_id,
      nombre: item.nombre,
      presentacion_nombre: item.presentacion_nombre || 'Unidad',
      precio: Number(item.precio),
      cantidad_vendida: Number(item.cantidad_presentacion),
      cantidad_devuelta: Number(item.cantidad_devuelta || 0),
      descuento_asignado: Number(item.descuento_asignado || 0),
      cantidad: ''
    })))
  }

  const confirmarDevolucionParcial = async (evento) => {
    evento.preventDefault()
    if (!motivoDevolucion.trim()) return setError('Escribe el motivo de la devolución')
    const items = lineasDevolucion.filter((linea) => Number(linea.cantidad) > 0).map((linea) => ({ detalle_venta_id: linea.detalle_venta_id, cantidad_presentacion: Number(linea.cantidad) }))
    if (!items.length) return setError('Indica al menos una cantidad para devolver')
    setGuardandoDevolucion(true)
    setError('')
    try {
      const respuesta = await fetch(`${API}/ventas/${devolucionEditando.id}/devolucion`, {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ motivo: motivoDevolucion, tipo: 'parcial', items })
      })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo registrar la devolución parcial')
      setDevolucionEditando(null)
      setTicketDevolucion(datos.devolucion)
      setMensaje(datos.mensaje)
      await cargarHistorial()
    } catch (err) {
      setError(err.message || 'No se pudo registrar la devolución parcial')
    } finally {
      setGuardandoDevolucion(false)
    }
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
        cantidad: Number(item.cantidad),
        presentacion_nombre: item.presentacion_nombre || ''
      }))
    })
  }

  const confirmarVenta = async () => {
    if (!carrito.length) return setError('Agrega al menos un producto')
    if (carrito.some((item) => !Number.isInteger(Number(item.cantidad)) || Number(item.cantidad) <= 0)) return setError('Completa una cantidad válida para cada producto')
    const unidadesPorProducto = carrito.reduce((acumulado, item) => {
      acumulado.set(item.id, (acumulado.get(item.id) || 0) + Number(item.cantidad) * Number(item.factor || 1))
      return acumulado
    }, new Map())
    const faltantes = [...unidadesPorProducto.entries()].filter(([id, cantidad]) => cantidad > Number(carrito.find((item) => item.id === id)?.stock || 0))
    if (faltantes.length) return setError(`Stock insuficiente: ${faltantes.map(([id, cantidad]) => `${carrito.find((item) => item.id === id)?.nombre} (solicitado ${cantidad})`).join(', ')}`)
    if (metodo === 'EFECTIVO' && Number(recibido || 0) < total) return setError(`El efectivo recibido debe ser al menos ${dinero(total)}`)
      if (metodo !== 'EFECTIVO' && !window.confirm(`Confirma que el pago por ${metodo} de ${dinero(total)} fue recibido.`)) return
    setGuardando(true)
    setError('')
    setMensaje('')
    try {
      const respuesta = await fetch(`${API}/ventas`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ usuario_id: usuario.id, sucursal_id: usuario.sucursal_id, cliente_nombre: cliente.nombre.trim() || null, cliente_telefono: cliente.telefono.trim() || null, items: carrito.map((item) => ({ producto_id: item.id, cantidad: item.cantidad, presentacion_id: item.presentacion_id })), metodo_pago: metodo, monto_recibido: metodo === 'EFECTIVO' ? Number(recibido) : total, descuento: descuentoNumero, impuesto_porcentaje: impuestoNumero })
      })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo registrar la venta')
      if (ventaInicial?.id) {
        const cotizacionRespuesta = await fetch(`${API}/cotizaciones/${ventaInicial.id}/convertida`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ venta_id: datos.venta.id }) })
        if (!cotizacionRespuesta.ok) throw new Error('La venta se registró, pero no se pudo actualizar el estado de la cotización')
      }
      setUltimaVenta({ ...datos.venta, carrito, impuesto: impuestoNumero })
      setProductos((anterior) => anterior.map((producto) => {
        const unidadesVendidas = carrito.filter((detalle) => detalle.id === producto.id).reduce((total, item) => total + item.cantidad * Number(item.factor || 1), 0)
        return unidadesVendidas ? { ...producto, stock_actual: Number(producto.stock_actual || 0) - unidadesVendidas } : producto
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
        <div className="ventas-heading-actions"><button className="ventas-button ventas-button-muted" onClick={cargarHistorial}>Historial</button><button className="ventas-button ventas-button-muted" onClick={pausarVenta} disabled={!carrito.length}>Pausar venta</button><button className="ventas-button ventas-button-muted" onClick={() => setCamaraAbierta(true)}>Escanear con cámara</button><button className="ventas-button ventas-button-muted" title="Enfocar el buscador para agregar otro producto" onClick={() => { busquedaRef.current?.focus(); busquedaRef.current?.select() }}>+ Buscar otro producto</button></div>
      </div>
      {error && <div className="ventas-error">{error}</div>}
      {mensaje && <div className="ventas-success">{mensaje}</div>}
      {camaraAbierta && <div className="camara-overlay"><div className="camara-modal"><div className="ventas-section-title"><h3>Escanear producto</h3><button className="caja-close" onClick={() => setCamaraAbierta(false)}>×</button></div><video ref={videoRef} className="camara-video" muted playsInline /><p>Apunta la cámara al código de barras.</p></div></div>}
        {pausadas.length > 0 && <section className="ventas-pausadas ventas-pausadas-top"><div className="ventas-section-title"><h3>Ventas pausadas</h3><span>{pausadas.length}</span></div>{pausadas.map((venta) => <div className="venta-pausada" key={venta.id}><button onClick={() => recuperarVenta(venta)}><span>Venta de {new Date(venta.fecha).toLocaleTimeString()}</span><b>{venta.carrito.length} productos</b></button><button className="ventas-link" onClick={() => setPausadas((anterior) => anterior.filter((item) => item.id !== venta.id))}>Cancelar</button></div>)}</section>}

        <div className="ventas-layout">
        <div className="ventas-catalogo">
            <div className="ventas-rapidos-header"><div><h3>Ventas rápidas</h3><small>Productos elegidos por el vendedor</small></div><button className="ventas-link" onClick={() => setConfigurandoRapidos(!configurandoRapidos)}>{configurandoRapidos ? 'Cerrar' : 'Configurar'}</button></div>
            {configurandoRapidos && <div className="ventas-rapidos-config">{productos.map((producto) => <label key={producto.id}><input type="checkbox" checked={productosRapidos.includes(producto.id)} onChange={() => setProductosRapidos((anterior) => anterior.includes(producto.id) ? anterior.filter((id) => id !== producto.id) : [...anterior, producto.id])} />{producto.nombre}<small>Stock {producto.stock_actual}</small></label>)}</div>}
            {!configurandoRapidos && <div className="ventas-rapidos">{productosRapidosDisponibles.map((producto) => {
              return renderTarjetaProducto(producto, true)
            })}{!productosRapidosDisponibles.length && <span className="ventas-empty ventas-empty-compact">Configura tus productos de mayor rotación.</span>}</div>}
          <div className="ventas-search"><span>⌕</span><input ref={busquedaRef} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && filtrados[0]) agregarProducto(filtrados[0]) }} placeholder="Buscar nombre o escanear código de barras" autoComplete="off" /></div>
          <div className="ventas-productos">{filtrados.map((producto) => {
            return renderTarjetaProducto(producto)
          })}{filtradosSinStock.map((producto) => <div className="venta-producto" key={`sin-${producto.id}`} style={{ opacity: 0.6 }}><div><strong>{producto.nombre}</strong><small>Sin stock en esta sucursal: registra una compra para poder venderlo</small></div></div>)}{!filtrados.length && !filtradosSinStock.length && <div className="ventas-empty">Escribe un nombre o código para buscar.</div>}</div>
        </div>
        <div className="ventas-carrito"><div className="ventas-section-title"><h3>Detalle de venta</h3><button className="ventas-link" onClick={limpiarVenta} disabled={!carrito.length && !recibido}>Limpiar</button></div><div className="ventas-items">{carrito.map((item) => <div className="venta-item" key={item.clave}><div><strong>{item.nombre}</strong><small>{dinero(item.precio)} c/u · Disponible {Math.floor(Number(item.stock || 0) / Number(item.factor || 1))} {item.presentacion_nombre || ''}</small></div><div className="venta-cantidad"><button onClick={() => cambiarCantidad(item.clave, item.cantidad - 1)}>-</button><b>{item.cantidad}</b><button onClick={() => cambiarCantidad(item.clave, item.cantidad + 1)} disabled={(item.cantidad + 1) * Number(item.factor || 1) > Number(item.stock || 0)}>+</button></div><strong>{dinero(item.precio * item.cantidad)}</strong></div>)}{!carrito.length && <div className="ventas-empty">El carrito está vacío.</div>}</div><div className="ventas-totales"><div><span>Subtotal</span><b>{dinero(subtotal)}</b></div><label>Descuento aprobado (Bs)<input type="number" min="0" step="any" value={descuento} disabled={!puedeAutorizarDescuento} onChange={(e) => setDescuento(e.target.value)} /></label>{!puedeAutorizarDescuento && <small>El descuento requiere la aprobación de un superior.</small>}<div><span>Descuento</span><b>- {dinero(descuentoNumero)}</b></div><label>Impuesto %<input type="number" min="0" step="any" value={impuesto} onChange={(e) => setImpuesto(e.target.value)} /></label><div className="ventas-total"><span>Total a cobrar</span><strong>{dinero(total)}</strong></div></div><div className="ventas-pago"><div className="ventas-cliente"><span>Cliente (opcional)</span><input list="ventas-clientes-lista" placeholder="Buscar cliente registrado (nombre o teléfono)" value={clienteBusqueda} onChange={(e) => elegirCliente(e.target.value)} /><datalist id="ventas-clientes-lista">{clientesRegistrados.map((c) => <option key={c.id} value={etiquetaCliente(c)} />)}</datalist><input maxLength="120" placeholder="Nombre" value={cliente.nombre} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} /><input maxLength="40" placeholder="Teléfono" value={cliente.telefono} onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })} />{(cliente.nombre || cliente.telefono) && <small style={{ color: clienteRegistrado ? '#176b43' : '#8b9992' }}>{clienteRegistrado ? '✓ Cliente registrado: esta venta entra a su historial' : 'Cliente no registrado: se guarda solo en esta venta (regístralo en Clientes con el mismo teléfono para llevar su historial)'}{!clienteRegistrado && cliente.nombre.trim() && <> <button type="button" className="ventas-link" onClick={guardarClienteDesdeVenta}>Guardar en Clientes</button></>}</small>}</div><label>Método de pago<select value={metodo} onChange={(e) => setMetodo(e.target.value)}>{METODOS.map((item) => <option key={item}>{item}</option>)}</select></label>{metodo === 'EFECTIVO' && <label>Efectivo recibido<input type="number" min="0" step="any" value={recibido} onChange={(e) => setRecibido(e.target.value)} placeholder="0.00" /></label>}<div className="ventas-cambio"><span>Cambio</span><strong>{dinero(metodo === 'EFECTIVO' ? cambio : 0)}</strong></div><button className="ventas-cobrar" onClick={confirmarVenta} disabled={guardando || !carrito.length}>{guardando ? 'Registrando...' : 'Cobrar venta'}</button></div></div>
      </div>
      {ultimaVenta && <div className="venta-ticket-overlay"><article className="venta-ticket"><div className="ticket-content">{empresa.logo && <img className="ticket-logo" src={empresa.logo} alt="Logo" />}<h2>{empresa.nombre}</h2>{empresa.direccion && <p>{empresa.direccion}</p>}{empresa.telefono && <p>{empresa.telefono}</p>}<p>Ticket de venta</p><p>Venta #{ultimaVenta.id} · {ultimaVenta.fecha ? new Date(ultimaVenta.fecha).toLocaleString() : ''}</p><p>{ultimaVenta.sucursal_nombre || ''} · Atendido por: {ultimaVenta.usuario_nombre || usuario.nombre}</p>{(ultimaVenta.cliente_nombre || ultimaVenta.cliente_telefono) && <p>Cliente: {ultimaVenta.cliente_nombre || ''} {ultimaVenta.cliente_telefono ? `· ${ultimaVenta.cliente_telefono}` : ''}</p>}<hr /><div className="ticket-table"><div className="ticket-table-header"><span>Cant.</span><span>Producto</span><span>P. Unit.</span><span>Subtotal</span></div>{ultimaVenta.carrito.map((item, indice) => <div className="ticket-table-row" key={`${item.id}-${indice}`}><span>{item.cantidad}{item.presentacion_nombre ? ` ${item.presentacion_nombre}` : ''}</span><span>{item.nombre}</span><span>{dinero(item.precio)}</span><strong>{dinero(item.precio * item.cantidad)}</strong></div>)}</div><hr /><div className="ticket-line"><span>Subtotal</span><b>{dinero(ultimaVenta.subtotal)}</b></div><div className="ticket-line"><span>Descuento</span><b>- {dinero(ultimaVenta.descuento)}</b></div><div className="ticket-line"><span>Impuesto ({ultimaVenta.impuesto_porcentaje || 0}%)</span><b>{dinero(ultimaVenta.impuesto)}</b></div><div className="ticket-line"><span>Total</span><b>{dinero(ultimaVenta.total)}</b></div><div className="ticket-line"><span>Forma de pago</span><b>{ultimaVenta.metodo_pago}</b></div><div className="ticket-line"><span>Recibido</span><b>{dinero(ultimaVenta.monto_recibido)}</b></div><div className="ticket-line"><span>Cambio</span><b>{dinero(ultimaVenta.cambio)}</b></div><p className="ticket-thanks">Gracias por su compra</p></div><div className="ticket-actions"><button className="ventas-button ventas-button-muted" onClick={() => setUltimaVenta(null)}>Cerrar</button><button className="ventas-button ventas-button-primary" onClick={imprimirTicket}>Imprimir ticket</button></div></article></div>}
      {mostrarHistorial && <div className="venta-ticket-overlay"><article className="ventas-historial"><div className="ventas-section-title"><div><span className="ventas-kicker">CONTROL DE VENTAS</span><h3>Historial reciente</h3></div><button className="caja-close" onClick={() => setMostrarHistorial(false)}>×</button></div>{historial.map((venta) => {
        const puedeDevolver = ['completada', 'devuelta_parcial'].includes(venta.estado)
        const etiquetaEstado = venta.estado === 'devuelta' ? 'Devuelta' : venta.estado === 'devuelta_parcial' ? 'Parcialmente devuelta' : 'Completada'
        return <div className="historial-venta" key={venta.id}>
          <div><strong>Venta #{venta.id} · {new Date(venta.fecha).toLocaleString()}</strong><small>{venta.usuario_nombre || 'Usuario'} · {venta.metodo_pago} · {venta.items.length} productos <span className={`estado-devolucion estado-devolucion-${venta.estado}`}>{etiquetaEstado}</span></small>
            {(venta.devoluciones || []).map((devolucion) => <small className="historial-ticket-devolucion" key={devolucion.id}>Ticket {devolucion.codigo} · {devolucion.tipo === 'total' ? 'total' : 'parcial'} · {dinero(devolucion.monto)}</small>)}
          </div>
          <b>{dinero(venta.total)}</b>
          <div className="historial-acciones"><button className="ventas-button ventas-button-muted" onClick={() => verTicketHistorial(venta)}>Ver ticket</button>
            {([1, '1'].includes(usuario?.rol_id) || ['dueño', 'dueno', 'propietario', 'admin', 'administrador', 'gerente general'].includes(String(usuario?.rol || '').toLowerCase())) && <>
              <button className="ventas-button ventas-button-muted" onClick={() => abrirDevolucionParcial(venta)} disabled={!puedeDevolver}>Devolver parcialmente</button>
              <button className="ventas-button ventas-button-muted" onClick={() => devolverVenta(venta)} disabled={!puedeDevolver}>Devolver todo</button>
            </>}
          </div>
        </div>
      })}{!historial.length && <div className="ventas-empty">No hay ventas registradas.</div>}</article></div>}

      {devolucionEditando && <div className="venta-ticket-overlay"><form className="devolucion-modal" onSubmit={confirmarDevolucionParcial}>
        <div className="ventas-section-title"><div><span className="ventas-kicker">DEVOLUCIÓN PARCIAL</span><h3>Venta #{devolucionEditando.id}</h3></div><button type="button" className="caja-close" onClick={() => setDevolucionEditando(null)}>×</button></div>
        {error && <div className="ventas-error" role="alert">{error}</div>}
        {lineasDevolucion.map((linea, indice) => {
          const restante = Math.max(0, linea.cantidad_vendida - linea.cantidad_devuelta)
          return <label className="devolucion-linea" key={linea.detalle_venta_id}><span><strong>{linea.nombre}</strong><small>{linea.presentacion_nombre} · Vendido {linea.cantidad_vendida} · Ya devuelto {linea.cantidad_devuelta} · Disponible para devolver {restante}</small></span><input type="number" min="0" max={restante} step="any" value={linea.cantidad} onChange={(e) => setLineasDevolucion((anteriores) => anteriores.map((item, posicion) => posicion === indice ? { ...item, cantidad: e.target.value } : item))} aria-label={`Cantidad a devolver de ${linea.nombre}`} /></label>
        })}
        <label className="devolucion-motivo">Motivo de devolución<input value={motivoDevolucion} onChange={(e) => setMotivoDevolucion(e.target.value)} required /></label>
        <small>Se repondrá solo la cantidad seleccionada. El importe exacto se calculará con el precio y descuento originales.</small>
        <div className="devolucion-acciones"><button type="button" className="ventas-button ventas-button-muted" onClick={() => setDevolucionEditando(null)} disabled={guardandoDevolucion}>Cancelar</button><button className="ventas-button ventas-button-primary" disabled={guardandoDevolucion}>{guardandoDevolucion ? 'Registrando…' : 'Confirmar devolución parcial'}</button></div>
      </form></div>}

      {ticketDevolucion && <div className="venta-ticket-overlay"><article className="devolucion-ticket"><span className="ventas-kicker">COMPROBANTE DE DEVOLUCIÓN</span><h2>{ticketDevolucion.codigo}</h2><p>Venta #{ticketDevolucion.venta_id} · {new Date(ticketDevolucion.fecha).toLocaleString()}</p><p>{ticketDevolucion.tipo === 'total' ? 'Devolución total' : 'Devolución parcial'}</p>{ticketDevolucion.items?.map((item, indice) => <div className="ticket-line" key={`${item.nombre}-${indice}`}><span>{item.cantidad_presentacion} {item.presentacion_nombre} · {item.nombre}</span><b>{dinero(item.monto)}</b></div>)}<hr /><div className="ticket-line"><strong>Total reembolsado</strong><strong>{dinero(ticketDevolucion.monto)}</strong></div><p>Motivo: {ticketDevolucion.motivo}</p><div className="devolucion-acciones"><button className="ventas-button ventas-button-muted" onClick={() => setTicketDevolucion(null)}>Cerrar</button><button className="ventas-button ventas-button-primary" onClick={imprimirTicket}>Imprimir ticket</button></div></article></div>}
    </section>
  )
}

export default Ventas
