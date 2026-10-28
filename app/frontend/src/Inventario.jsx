import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import JsBarcode from 'jsbarcode'
import { API } from './api'

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('tieri_token') || ''}`, 'Content-Type': 'application/json' })

function CodigoBarrasTransferencia({ codigo }) {
  const svgRef = useRef(null)
  useEffect(() => {
    if (svgRef.current && codigo) JsBarcode(svgRef.current, codigo, { format: 'CODE128', height: 64, displayValue: true, fontSize: 14, margin: 8 })
  }, [codigo])
  return <svg ref={svgRef} aria-label={`Código de barras ${codigo}`} />
}

// El stock real siempre se guarda como un solo número (unidades sueltas). Esto solo lo
// "traduce" para mostrarlo de forma humana: 86 unidades con presentaciones Caja=15 y
// Media caja=7 se muestra como "5 caja + 1 media caja + 4 unidad".
const desglosarStock = (stockBase, presentaciones) => {
  if (!presentaciones?.length || presentaciones.length < 2) return null
  const ordenado = [...presentaciones].sort((a, b) => Number(b.factor) - Number(a.factor))
  let restante = Math.floor(Number(stockBase) || 0)
  const partes = []
  for (const p of ordenado) {
    const factor = Math.floor(Number(p.factor) || 0)
    if (factor <= 0) continue
    const cantidad = Math.floor(restante / factor)
    if (cantidad > 0) {
      partes.push(`${cantidad} ${p.nombre}`)
      restante -= cantidad * factor
    }
  }
  return partes.length ? partes.join(' + ') : null
}

const descomponerStockInicial = (stockBase, presentaciones) => {
  const indice = presentaciones.reduce((mayor, item, posicion) => Number(item.factor) > Number(presentaciones[mayor]?.factor || 1) ? posicion : mayor, 0)
  const factor = Number(presentaciones[indice]?.factor) || 1
  const cantidad = Math.floor((Number(stockBase) || 0) / factor)
  return { indice, cantidad, unidadesSueltas: Math.max(0, (Number(stockBase) || 0) - cantidad * factor) }
}

const obtenerIndicePresentacionBase = (presentaciones, unidad) => {
  const unidadBase = String(unidad || 'Unidad').trim().toLowerCase()
  const indicePorUnidad = presentaciones.findIndex((item) => String(item.nombre || '').trim().toLowerCase() === unidadBase && Number(item.factor) === 1)
  if (indicePorUnidad >= 0) return indicePorUnidad
  const indiceUnitario = presentaciones.findIndex((item) => Number(item.factor) === 1)
  if (indiceUnitario >= 0) return indiceUnitario
  return presentaciones.reduce((menor, item, indice) => {
    const factor = Number(item.factor)
    const factorMenor = Number(presentaciones[menor]?.factor)
    return Number.isFinite(factor) && factor > 0 && (!Number.isFinite(factorMenor) || factor < factorMenor) ? indice : menor
  }, 0)
}

function Inventario({ usuario, modoCreacion = false, nombreInicial = '', productoParaEditar = null, onProductoCreado, onCancelarCreacion }) {
  const imprimirTicketTraslado = () => {
    const configurado = localStorage.getItem(`tieri_ancho_ticket_${usuario.sucursal_id}`)
    const valor = configurado === '80' ? 80 : 58
    document.body.classList.add('tieri-print-portal')
    document.body.style.setProperty('--ticket-print-width', `${valor}mm`)
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('tieri-print-portal')
      document.body.style.removeProperty('--ticket-print-width')
    }, { once: true })
    window.print()
  }

  const [productos, setProductos] = useState([])
  const [mostrarDeshabilitados, setMostrarDeshabilitados] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [excelVistaPrevia, setExcelVistaPrevia] = useState([])
  const [mostrarVistaExcel, setMostrarVistaExcel] = useState(false)
  const [error, setError] = useState('')
  const [paginaActual, setPaginaActual] = useState(1)
  const [productosPorPagina, setProductosPorPagina] = useState(50)

  const [mostrarNuevoProducto, setMostrarNuevoProducto] = useState(modoCreacion)
  const [guardando, setGuardando] = useState(false)
  const [productoEditando, setProductoEditando] = useState(null)
  const [mensajeExito, setMensajeExito] = useState('')

  const puedeTransferir = [1, '1'].includes(usuario?.rol_id) || ['dueño', 'dueno', 'propietario', 'admin', 'administrador'].includes(String(usuario?.rol || '').toLowerCase()) || usuario?.permisos?.includes('inventario.transferir')
  const [sucursales, setSucursales] = useState([])
  const [transfiriendoProducto, setTransfiriendoProducto] = useState(null)
  const [sucursalDestinoTransferencia, setSucursalDestinoTransferencia] = useState('')
  const [notaTransferencia, setNotaTransferencia] = useState('')
  const [lineasTransferencia, setLineasTransferencia] = useState([])
  const [guardandoTransferencia, setGuardandoTransferencia] = useState(false)
  const [mostrarHistorialTransferencias, setMostrarHistorialTransferencias] = useState(false)
  const [historialTransferencias, setHistorialTransferencias] = useState([])
  const [codigoBusquedaTransferencia, setCodigoBusquedaTransferencia] = useState('')
  const [ticketEnRecepcion, setTicketEnRecepcion] = useState(null)
  const [lineasRecepcion, setLineasRecepcion] = useState([])
  const [notaRecepcion, setNotaRecepcion] = useState('')
  const [ticketImpresion, setTicketImpresion] = useState(null)
  const [guardandoRecepcion, setGuardandoRecepcion] = useState(false)
  const [errorTransferencia, setErrorTransferencia] = useState('')

  useEffect(() => {
    if (!puedeTransferir) return
    fetch(`${API}/sucursales`, { headers: auth() })
      .then((respuesta) => respuesta.json())
      .then((datos) => { if (datos.ok) setSucursales(datos.sucursales || []) })
      .catch(() => {})
  }, [puedeTransferir])

  const abrirTransferencia = (producto) => {
    setErrorTransferencia('')
    setTransfiriendoProducto(producto)
    setSucursalDestinoTransferencia('')
    setNotaTransferencia('')
    setLineasTransferencia([{ producto_id: String(producto.id), presentacion_id: String(producto.presentaciones?.[0]?.id || ''), cantidad_presentacion: '1', unidades_sueltas: '' }])
  }

  const actualizarLineaTransferencia = (indice, campo, valor) => setLineasTransferencia((anteriores) => anteriores.map((linea, posicion) => {
    if (posicion !== indice) return linea
    if (campo === 'producto_id') {
      const producto = productos.find((item) => String(item.id) === String(valor))
      return { ...linea, producto_id: valor, presentacion_id: String(producto?.presentaciones?.[0]?.id || ''), cantidad_presentacion: '1', unidades_sueltas: '' }
    }
    return { ...linea, [campo]: valor }
  }))

  const actualizarHistorialTransferencias = async () => {
    const respuesta = await fetch(`${API}/transferencias`, { headers: auth() })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo cargar el historial de transferencias')
    const anteriores = (datos.transferencias || []).map((item) => ({
      id: `legacy-${item.id}`, codigo: `ANT-${item.id}`, estado: 'historica', fecha: item.fecha,
      sucursal_origen: item.sucursal_origen, sucursal_destino: item.sucursal_destino, usuario: item.usuario,
      items: [{ producto: item.producto, cantidad: Number(item.cantidad), cantidad_recibida: Number(item.cantidad) }]
    }))
    setHistorialTransferencias([...(datos.tickets || []), ...anteriores])
  }

  const abrirRecepcion = (ticket) => {
    setErrorTransferencia('')
    setTicketEnRecepcion(ticket)
    setLineasRecepcion(ticket.items.map((item) => ({ item_id: item.id, producto: item.producto, presentacion_nombre: item.presentacion_nombre, cantidad: Number(item.cantidad), cantidad_recibida: '' })))
    setNotaRecepcion('')
  }

  const enviarTransferencia = async (evento) => {
    evento.preventDefault()
    setGuardandoTransferencia(true)
    setErrorTransferencia('')
    try {
      const items = lineasTransferencia.map((linea) => {
        const producto = productos.find((item) => String(item.id) === String(linea.producto_id))
        const presentacion = producto?.presentaciones?.find((item) => String(item.id) === String(linea.presentacion_id))
        const cantidadPresentacion = Number(linea.cantidad_presentacion) || 0
        const unidadesSueltas = Number(linea.unidades_sueltas) || 0
        const cantidadBase = cantidadPresentacion * Number(presentacion?.factor || 1) + unidadesSueltas
        if (!producto || cantidadBase <= 0) throw new Error('Completa producto y cantidad en todas las líneas')
        if (cantidadBase > Number(producto.stock_actual || 0)) throw new Error(`La cantidad supera el stock disponible de ${producto.nombre}`)
        return { producto_id: producto.id, presentacion_id: presentacion?.id || null, cantidad_presentacion: cantidadPresentacion, unidades_sueltas: unidadesSueltas }
      })
      const respuesta = await fetch(`${API}/transferencias`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({
          sucursal_origen_id: usuario.sucursal_id,
          sucursal_destino_id: Number(sucursalDestinoTransferencia),
          items,
          nota: notaTransferencia
        })
      })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo transferir el stock')
      setTicketImpresion({ ...datos.ticket, sucursal_origen: sucursales.find((s) => Number(s.id) === Number(usuario.sucursal_id))?.nombre, sucursal_destino: sucursales.find((s) => Number(s.id) === Number(sucursalDestinoTransferencia))?.nombre })
      setMensajeExito('')
      setTransfiriendoProducto(null)
      cargarProductos()
    } catch (err) {
      setErrorTransferencia(err.message || 'No se pudo crear el ticket')
    } finally {
      setGuardandoTransferencia(false)
    }
  }

  const verHistorialTransferencias = async () => {
    setErrorTransferencia('')
    setMostrarHistorialTransferencias(true)
    try {
      await actualizarHistorialTransferencias()
    } catch (err) { setErrorTransferencia(err.message || 'No se pudo cargar el historial') }
  }

  const buscarTicketPorCodigo = async (codigo = codigoBusquedaTransferencia) => {
    const codigoLimpio = String(codigo).trim().toUpperCase()
    if (!codigoLimpio) return setErrorTransferencia('Escanea o escribe el código del ticket')
    setErrorTransferencia('')
    try {
      const respuesta = await fetch(`${API}/transferencias/ticket/${encodeURIComponent(codigoLimpio)}`, { headers: auth() })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se encontró el ticket')
      const ticket = datos.ticket
      setHistorialTransferencias((anteriores) => [ticket, ...anteriores.filter((item) => item.codigo !== ticket.codigo)])
    if (ticket.estado !== 'en_transito') return setErrorTransferencia(`El ticket ${ticket.codigo} está ${ticket.estado.replaceAll('_', ' ')}`)
    if (Number(ticket.sucursal_destino_id) !== Number(usuario.sucursal_id)) return setErrorTransferencia('Este ticket no corresponde a esta sucursal receptora')
    abrirRecepcion(ticket)
    } catch (err) {
      setErrorTransferencia(err.message || 'No se encontró el ticket')
    }
  }

  const confirmarRecepcionTransferencia = async (evento, cerrarConDiferencia = false) => {
    evento?.preventDefault()
    setGuardandoRecepcion(true)
    setErrorTransferencia('')
    try {
      const respuesta = await fetch(`${API}/transferencias/${encodeURIComponent(ticketEnRecepcion.codigo)}/recepcion`, {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ items: lineasRecepcion.map((linea) => ({ item_id: linea.item_id, cantidad_recibida: Number(linea.cantidad_recibida) || 0 })), nota: notaRecepcion, cerrar_con_diferencia: cerrarConDiferencia })
      })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo registrar la recepción')
      setMensajeExito(datos.mensaje)
      setTicketEnRecepcion(null)
      await actualizarHistorialTransferencias()
      await cargarProductos()
    } catch (err) { setErrorTransferencia(err.message || 'No se pudo registrar la recepción') }
    finally { setGuardandoRecepcion(false) }
  }

  const anularTransferencia = async (ticket) => {
    if (!window.confirm(`¿Confirmas que el saldo pendiente del ticket ${ticket.codigo} regresó físicamente a ${ticket.sucursal_origen}? Se devolverá ese saldo al stock de origen.`)) return
    setErrorTransferencia('')
    try {
      const respuesta = await fetch(`${API}/transferencias/${encodeURIComponent(ticket.codigo)}/anular`, { method: 'POST', headers: auth(), body: JSON.stringify({ confirmar_devolucion: true }) })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo anular el ticket')
      setMensajeExito(datos.mensaje)
      await actualizarHistorialTransferencias()
      await cargarProductos()
    } catch (err) { setErrorTransferencia(err.message || 'No se pudo anular la transferencia') }
  }
  const nombreProductoRef = useRef(null)
  const codigoBarrasRef = useRef(null)
  
  const cerrarVistaExcel = () => {
  setMostrarVistaExcel(false)
  setExcelVistaPrevia([])
}

  const [nuevoProducto, setNuevoProducto] = useState({
    nombre: '',
    codigo_barras: '',
    marca: '',
    categoria_id: '',
    proveedor_id: '',
    unidad: 'Unidad',
    descripcion: '',
    precio_compra: '',
    precio_venta: '',
    stock_inicial: '',
    stock_inicial_presentacion: '0',
    stock_inicial_unidades_sueltas: '',
    stock_minimo: '',
    imagen_url: '',
    presentaciones: [{ nombre: 'Unidad', factor: '1', costo: '', precio_venta: '' }]
  })
  const indicePresentacionBase = obtenerIndicePresentacionBase(nuevoProducto.presentaciones, nuevoProducto.unidad)

  useEffect(() => {
    cargarProductos()
  }, [usuario?.sucursal_id])

  useEffect(() => {
    if (!mostrarNuevoProducto) {
      return undefined
    }

    nombreProductoRef.current?.focus()

    const cerrarConEscape = (evento) => {
      if (evento.key === 'Escape' && !guardando) {
        setProductoEditando(null)
        setError('')
        setMostrarNuevoProducto(false)
      }
    }

    document.addEventListener('keydown', cerrarConEscape)

    return () => document.removeEventListener('keydown', cerrarConEscape)
  }, [mostrarNuevoProducto, guardando])

  const cargarProductos = async () => {
    try {
      setCargando(true)
      setError('')

      const respuesta = await fetch(`${API}/productos?sucursal_id=${usuario.sucursal_id}`, { headers: auth() })
      const datos = await respuesta.json()

      if (!respuesta.ok || !datos.ok) {
        throw new Error(
          datos.mensaje || 'No se pudieron cargar los productos'
        )
      }

      setProductos(datos.productos || [])
    } catch (err) {
      setError(err.message || 'Error conectando con el servidor')
    } finally {
      setCargando(false)
    }
  }
const cargarProductosDeshabilitados = async () => {
  try {
    setError('')

    const respuesta = await fetch(
      `${API}/productos/deshabilitados?sucursal_id=${usuario.sucursal_id}`,
      { headers: auth() }
    )

    const datos = await respuesta.json()

    if (!respuesta.ok || !datos.ok) {
      throw new Error(
        datos.mensaje ||
        'No se pudieron cargar los productos deshabilitados'
      )
    }

    setProductos(datos.productos || [])

  } catch (err) {
    setError(
      err.message ||
      'Error cargando productos deshabilitados'
    )
  }
}

const importarExcel = async (evento) => {
  const archivo = evento.target.files?.[0]

  if (!archivo) {
    return
  }

  try {
    setError('')

    const datos = await archivo.arrayBuffer()
    const libro = XLSX.read(datos, {
      type: 'array'
    })

    const primeraHoja = libro.Sheets[libro.SheetNames[0]]

    const filas = XLSX.utils.sheet_to_json(primeraHoja, {
      defval: ''
    })

    if (filas.length === 0) {
      alert('El archivo Excel está vacío.')
      return
    }

    setExcelVistaPrevia(filas)
    setMostrarVistaExcel(true)
 	 	
  } catch (error) {
    console.error('ERROR IMPORTANDO EXCEL:', error)

    setError(
      error.message || 'No se pudo leer el archivo Excel'
    )
  } finally {
    evento.target.value = ''
  }
}  
const productosFiltrados = productos.filter((producto) => {
    const texto = busqueda.toLowerCase()

    return (
      producto.nombre?.toLowerCase().includes(texto) ||
      producto.codigo_interno?.toLowerCase().includes(texto) ||
      producto.codigo_barras?.toLowerCase().includes(texto) ||
      producto.categoria?.toLowerCase().includes(texto) ||
      producto.marca?.toLowerCase().includes(texto)
    )
  })
  
  const totalPaginas = Math.max(
    1,
    Math.ceil(
      productosFiltrados.length / productosPorPagina
    )
  )

  const productosPaginados = productosFiltrados.slice(
    (paginaActual - 1) * productosPorPagina,
    paginaActual * productosPorPagina
  )

  const estadoStock = (producto) => {
    const stock = Number(producto.stock_actual || 0)
    const minimo = Number(producto.stock_minimo || 0)

    if (stock <= minimo) {
      return {
        clase: 'stock-low',
        texto: 'Stock bajo'
      }
    }

    if (stock <= minimo * 2) {
      return {
        clase: 'stock-warning',
        texto: 'Vigilar'
      }
    }

    return {
      clase: 'stock-ok',
      texto: 'Disponible'
    }
  }

  const cambiarCampo = (campo, valor) => {
  const valorFinal =
    campo === 'nombre'
      ? valor.toUpperCase()
      : valor

  setNuevoProducto((anterior) => ({
    ...anterior,
    [campo]: valorFinal
  }))
}

  const actualizarPresentacion = (indice, campo, valor) => {
    setNuevoProducto((anterior) => {
      const presentaciones = anterior.presentaciones.map((presentacion, posicion) => posicion === indice ? { ...presentacion, [campo]: valor } : presentacion)
      const indiceBaseAnterior = obtenerIndicePresentacionBase(anterior.presentaciones, anterior.unidad)
      const indiceBaseNuevo = obtenerIndicePresentacionBase(presentaciones, anterior.unidad)
      const presentacionBase = presentaciones[indiceBaseNuevo]
      const factorBase = Number(presentacionBase?.factor) || 1
      const baseCambio = indiceBaseAnterior !== indiceBaseNuevo
      const editarPrecioBase = indice === indiceBaseNuevo && (campo === 'costo' || campo === 'precio_venta')
      const sincronizarPrecios = baseCambio || editarPrecioBase
      const costoBase = presentacionBase?.costo === '' ? Number(anterior.precio_compra || 0) * factorBase : Number(presentacionBase?.costo) || 0
      const ventaBase = presentacionBase?.precio_venta === '' ? Number(anterior.precio_venta || 0) * factorBase : Number(presentacionBase?.precio_venta) || 0
      return {
        ...anterior,
        presentaciones,
        ...(sincronizarPrecios ? {
          precio_compra: costoBase / factorBase,
          precio_venta: ventaBase / factorBase
        } : {})
      }
    })
  }

  const agregarPresentacion = () => {
    setNuevoProducto((anterior) => ({
      ...anterior,
      presentaciones: [...anterior.presentaciones, { nombre: '', factor: '', costo: '', precio_venta: '' }]
    }))
  }

  const eliminarPresentacion = (indice) => {
    setNuevoProducto((anterior) => ({
      ...anterior,
      presentaciones: anterior.presentaciones.filter((_, posicion) => posicion !== indice)
    }))
  }

  const dinero = (valor) => `Bs ${Number(valor || 0).toFixed(2)}`
  const presentacionStockInicial = nuevoProducto.presentaciones[Number(nuevoProducto.stock_inicial_presentacion)] || nuevoProducto.presentaciones[0]
  const stockInicialConvertido = (Number(nuevoProducto.stock_inicial) || 0) * (Number(presentacionStockInicial?.factor) || 1) + (Number(nuevoProducto.stock_inicial_unidades_sueltas) || 0)

  const seleccionarImagen = (evento) => {
    const archivo = evento.target.files?.[0]

    if (!archivo) {
      return
    }

    if (archivo.size > 600000) {
      setError('La imagen debe pesar menos de 600 KB.')
      return
    }

    const lector = new FileReader()
    lector.onload = () => cambiarCampo('imagen_url', lector.result)
    lector.readAsDataURL(archivo)
  }
	const limpiarFormulario = () => {
  
	setProductoEditando(null)

  
	setError('')
	
	setNuevoProducto({
    
	nombre: '',
    
	codigo_barras: '',
    
	marca: '',
    
	categoria_id: '',
    
	proveedor_id: '',
    
	unidad: 'Unidad',
    
	descripcion: '',
    
	precio_compra: '',
    
	precio_venta: '',
    
	stock_inicial: '',
    
  stock_minimo: '',

  imagen_url: '',
  presentaciones: [{ nombre: 'Unidad', factor: '1', costo: '', precio_venta: '' }]
  
	})
	
}

	  const guardarNuevoProducto = async (e) => {
    
	  e.preventDefault()

    

	if (!nuevoProducto.nombre.trim()) {
      
	alert('El nombre del producto es obligatorio.')
      
	return
    
	}
  const nombresPresentacion = nuevoProducto.presentaciones.map((item) => String(item.nombre || '').trim().toLowerCase())
  const nombreDuplicado = nombresPresentacion.find((nombre, indice) => nombre && nombresPresentacion.indexOf(nombre) !== indice)
  if (nombreDuplicado) {
    setError(`La presentación "${nombreDuplicado}" está repetida. Usa nombres distintos, por ejemplo "Unidad" y "Docena".`)
    return
  }

  const presentacionBase = nuevoProducto.presentaciones[indicePresentacionBase]
  const factorBase = Number(presentacionBase?.factor) || 1
  const costoBase = presentacionBase?.costo === '' ? Number(nuevoProducto.precio_compra) || 0 : Number(presentacionBase?.costo) || 0
  const ventaBase = presentacionBase?.precio_venta === '' ? Number(nuevoProducto.precio_venta) || 0 : Number(presentacionBase?.precio_venta) || 0
  const precioCompraBase = costoBase / factorBase
  const precioVentaBase = ventaBase / factorBase



	try {
      
		setGuardando(true)
      
		setError('')

      
	const respuesta = await fetch(
        
	productoEditando
          
  ? `${API}/productos/${productoEditando.id}`
          
  : `${API}/productos`,
        
	{
          
	method: productoEditando ? 'PUT' : 'POST',
          
	headers: auth(),
          
	body: JSON.stringify({
            
	...nuevoProducto,
            
	categoria_id: nuevoProducto.categoria_id || null,
            
  proveedor_id: nuevoProducto.proveedor_id || null,
  stock_base: productoEditando ? Number(productoEditando.stock_actual) || 0 : null,
            
  precio_compra: precioCompraBase,
            
  precio_venta: ventaBase,
            
              stock_inicial: modoCreacion ? Number(productoEditando?.stock_actual) || 0 : stockInicialConvertido,
            
            stock_minimo: Number(nuevoProducto.stock_minimo) || 0,
            presentaciones: nuevoProducto.presentaciones.map((item) => ({
              nombre: item.nombre,
              factor: Number(item.factor),
              costo: item.costo === '' ? undefined : Number(item.costo),
              precio_venta: item.precio_venta === '' ? precioVentaBase * Number(item.factor || 1) : Number(item.precio_venta)
            })),
            sucursal_id: usuario.sucursal_id
          
	})
        
      }
      
     )

      
	const datos = await respuesta.json()

 
     
	if (!respuesta.ok || !datos.ok) {
        
	throw new Error(
          
	datos.mensaje || 'No se pudo guardar el producto'
        
	)
      
       }

   
   
  if (modoCreacion) {
  if (onProductoCreado) await onProductoCreado(datos.producto || { id: productoEditando?.id, nombre: nuevoProducto.nombre })
  return
}

/// CORRECCIÓN: Avisa correctamente si se creó o si se editó
setMensajeExito(
  productoEditando
    ? 'Producto actualizado correctamente.'
    : 'Producto creado correctamente.'
)

// CORRECCIÓN: Limpia las variables de edición y cierra la ventana
limpiarFormulario()
setMostrarNuevoProducto(false)
setProductoEditando(null)  // ← ESTA LÍNEA ES LA CLAVE

// Recarga la lista de productos actualizados
await cargarProductos()

  
  
	} catch (err) {
      
	setError(
        
	err.message || 'No se pudo guardar el producto'
      
	)
    
	} finally {
      
	setGuardando(false)
    
	 }
  
	}

  useEffect(() => {
    if (modoCreacion && nombreInicial) setNuevoProducto((anterior) => ({ ...anterior, nombre: String(nombreInicial).toUpperCase() }))
  }, [])

  useEffect(() => {
    if (!modoCreacion || !productoParaEditar) return
    const producto = productoParaEditar
    const presentaciones = producto.presentaciones?.length
      ? producto.presentaciones.map((item) => ({ nombre: item.nombre, factor: String(item.factor), costo: item.costo != null ? String(item.costo) : '', precio_venta: String(item.precio_venta) }))
      : [{ nombre: producto.unidad || 'Unidad', factor: '1', costo: '', precio_venta: String(producto.precio_venta_actual || '') }]
    const stockDesglosado = descomponerStockInicial(producto.stock_actual || 0, presentaciones)
    setProductoEditando(producto)
    setNuevoProducto({
      nombre: producto.nombre || '',
      codigo_barras: producto.codigo_barras || '',
      marca: producto.marca || '',
      categoria_id: producto.categoria_id || '',
      proveedor_id: producto.proveedor_id || '',
      unidad: producto.unidad || 'Unidad',
      descripcion: producto.descripcion || '',
      precio_compra: producto.precio_compra_actual || '',
      precio_venta: producto.precio_venta_actual || '',
      stock_inicial: String(stockDesglosado.cantidad),
      stock_inicial_presentacion: String(stockDesglosado.indice),
      stock_inicial_unidades_sueltas: String(stockDesglosado.unidadesSueltas),
      stock_minimo: producto.stock_minimo || '',
      imagen_url: producto.imagen_url || '',
      presentaciones
    })
  }, [])

  useEffect(() => {
    if (modoCreacion && !mostrarNuevoProducto && onCancelarCreacion) onCancelarCreacion()
  }, [mostrarNuevoProducto])

  return (
    <section className={modoCreacion ? 'inventory-page inventory-page-solo-formulario' : 'inventory-page'}>

      <div className="inventory-top">

        <div>
          <h2>Inventario</h2>
          <p>Productos registrados en Tienda Tieri</p>
        </div>

        <div className="inventory-actions">

          <>
  <input
    id="input-importar-excel"
    type="file"
    accept=".xlsx,.xls"
    style={{ display: 'none' }}
    onChange={importarExcel}
  />

  <button
  className="secondary-button"
  type="button"
  onClick={() => {
    setMostrarNuevoProducto(false)
    setProductoEditando(null)
    limpiarFormulario()
    cerrarVistaExcel()

    document
      .getElementById('input-importar-excel')
      .click()
  }}
>
  📥 Importar Excel
</button>
</>

          <button
  className="secondary-button"
  type="button"
  onClick={() => {
    const datosExcel = productos.map((producto) => ({
      'Código interno': producto.codigo_interno || '',
      'Código de barras': producto.codigo_barras || '',
      'Nombre': producto.nombre || '',
      'Marca': producto.marca || '',
      'Categoría': producto.categoria || '',
      'Unidad': producto.unidad || '',
      'Precio compra': producto.precio_compra_actual || 0,
      'Precio venta': producto.precio_venta_actual || 0,
      'Stock actual': producto.stock_actual || 0,
      'Stock mínimo': producto.stock_minimo || 0
    }))

    const hoja = XLSX.utils.json_to_sheet(datosExcel)
    const libro = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(
      libro,
      hoja,
      'Inventario'
    )

    XLSX.writeFile(
      libro,
      'Inventario_Tienda_Tieri.xlsx'
    )
  }}
>
  📤 Exportar Excel
</button>
	<button
  className="secondary-button"
  type="button"
  onClick={async () => {
    if (mostrarDeshabilitados) {
      await cargarProductos()
      setMostrarDeshabilitados(false)
    } else {
      await cargarProductosDeshabilitados()
      setMostrarDeshabilitados(true)
    }
  }}
	>
  {mostrarDeshabilitados
    ? 'Ver productos activos'
    : 'Ver productos deshabilitados'}
</button>
          {puedeTransferir && <button className="secondary-button" type="button" onClick={verHistorialTransferencias}>Historial de transferencias</button>}
          {([1, '1'].includes(usuario?.rol_id) || ['dueño', 'dueno', 'propietario', 'admin', 'administrador'].includes(String(usuario?.rol || '').toLowerCase()) || usuario?.permisos?.includes('inventario.crear')) && <button
            className="primary-button"
            type="button"
            onClick={() => {
  
	    cerrarVistaExcel()
  
	    setProductoEditando(null)
  
	    limpiarFormulario()
  
	    setMostrarNuevoProducto(true)

	}}

          >
            + Nuevo producto
          </button>}

        </div>

      </div>

      <div className="inventory-toolbar">

        <div className="search-box">
          🔎

          <input
            type="text"
            placeholder="Buscar por nombre, código, marca o categoría..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />

        </div>

        <div className="inventory-count">
          {productosFiltrados.length} productos
        </div>

        <button
          className="refresh-button"
          type="button"
          onClick={cargarProductos}
        >
          ↻ Actualizar
        </button>

      </div>

      {cargando && (
        <div className="inventory-message">
          Cargando productos...
        </div>
      )}

      {error && (
        <div className="inventory-error">
          {error}
        </div>
      )}

      {!cargando && !error && (
        <div className="inventory-table-container">

          <table className="inventory-table">

            <thead>
              <tr>
                <th>Producto</th>
                <th>Código</th>
                <th>Categoría</th>
                <th>Marca</th>
                <th>Unidad</th>
		<th>Precio compra</th>
                <th>Precio venta</th>
                <th>Stock</th>
		<th>Stock mínimo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>

              {productosPaginados.map((producto) => {

                const estado = estadoStock(producto)
                const presentacionBase = producto.presentaciones?.find((presentacion) => Number(presentacion.factor) === 1)
                const presentacionPrecio = producto.presentaciones?.find((presentacion) => String(presentacion.nombre || '').trim().toLowerCase() === String(producto.unidad || '').trim().toLowerCase())
                  || presentacionBase
                  || producto.presentaciones?.reduce((menor, presentacion) => !menor || Number(presentacion.factor) < Number(menor.factor) ? presentacion : menor, null)
                const precioVentaPresentacion = presentacionPrecio?.precio_venta ?? (Number(producto.precio_venta_actual || 0) * Number(presentacionPrecio?.factor || 1))

                return (
                  <tr key={producto.id}>

                    <td>
                      <div className="product-name">
                        <strong>
                          {producto.nombre}
                        </strong>

                        {producto.descripcion && (
                          <small>
                            {producto.descripcion}
                          </small>
                        )}
                      </div>
                    </td>

                    <td>
                      <span className="code">
                        {producto.codigo_barras || producto.codigo_interno || '-'}
                      </span>
                    </td>

                    <td>
                      {producto.categoria || '-'}
                    </td>

                    <td>
                      {producto.marca || '-'}
                    </td>

                    <td>
                      {producto.unidad || '-'}
                    </td>

                    <td>
  {producto.precio_compra_actual === undefined ? '—' : <>
                        {(producto.presentaciones?.length ? producto.presentaciones : [{ nombre: presentacionBase?.nombre || producto.unidad || 'Unidad', factor: 1, costo: producto.precio_compra_actual }]).map((presentacion, indice) => <div key={presentacion.id || presentacion.nombre}><small style={{ color: indice === 0 ? '#354a42' : '#5f6f68', fontWeight: indice === 0 ? 700 : 400 }}>{presentacion.nombre}: Bs {Number(presentacion.costo ?? Number(producto.precio_compra_actual || 0) * Number(presentacion.factor || 1)).toFixed(2)}</small></div>)}
  </>}
</td>

<td>
  <strong>
    Bs{' '}
    {Number(
      precioVentaPresentacion
    ).toFixed(2)}
  </strong>
  {producto.presentaciones?.length > 1 && <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
    {producto.presentaciones.filter((p) => p.nombre !== (producto.unidad || 'Unidad')).map((p) => <small key={p.id || p.nombre} style={{ color: '#5f6f68' }}>{p.nombre}: Bs {Number(p.precio_venta || 0).toFixed(2)}</small>)}
  </div>}
</td>

                    <td>
  <strong>
    {Number(
      producto.stock_actual || 0
    )}
  </strong>
  {desglosarStock(producto.stock_actual, producto.presentaciones) && <div><small style={{ color: '#5f6f68' }}>{desglosarStock(producto.stock_actual, producto.presentaciones)}</small></div>}
</td>

<td>
  <strong>
    {Number(
      producto.stock_minimo || 0
    )}
  </strong>
</td>

<td>
  <span
    className={`stock-badge ${estado.clase}`}
  >
    {estado.texto}
  </span>
</td>

                    <td>
  {producto.puede_editar === false
    ? <span style={{ fontSize: '11px', color: '#9aa7a2' }}>Sin permiso</span>
    : <div style={{ display: 'flex', gap: '8px' }}>

    <button
      className="table-action"
      type="button"
      onClick={() => {
	cerrarVistaExcel()
        setProductoEditando(producto)
  const presentaciones = producto.presentaciones?.length
    ? producto.presentaciones.map((item) => ({ nombre: item.nombre, factor: String(item.factor), costo: item.costo != null ? String(item.costo) : '', precio_venta: String(item.precio_venta) }))
    : [{ nombre: producto.unidad || 'Unidad', factor: '1', costo: '', precio_venta: String(producto.precio_venta_actual || '') }]
  const stockDesglosado = descomponerStockInicial(producto.stock_actual || 0, presentaciones)

        setNuevoProducto({
          nombre: producto.nombre || '',
          codigo_barras: producto.codigo_barras || '',
          marca: producto.marca || '',
          categoria_id: producto.categoria_id || '',
          proveedor_id: producto.proveedor_id || '',
          unidad: producto.unidad || 'Unidad',
          descripcion: producto.descripcion || '',
          precio_compra: producto.precio_compra_actual || '',
          precio_venta: producto.precio_venta_actual || '',
            stock_inicial: String(stockDesglosado.cantidad),
            stock_inicial_presentacion: String(stockDesglosado.indice),
            stock_inicial_unidades_sueltas: String(stockDesglosado.unidadesSueltas),
            stock_minimo: producto.stock_minimo || '',
            imagen_url: producto.imagen_url || '',
            presentaciones
        })

        setMostrarNuevoProducto(true)
      }}
    >
      Editar
    </button>

    <button
  className="table-action"
  type="button"
  onClick={async () => {
    const nuevoEstado = producto.activo === false

    const confirmar = window.confirm(
      nuevoEstado
        ? `¿Deseas habilitar el producto "${producto.nombre}"?`
        : `¿Deseas deshabilitar el producto "${producto.nombre}"?`
    )

    if (!confirmar) {
      return
    }

    try {
      setError('')

      const respuesta = await fetch(
        `${API}/productos/${producto.id}/estado`,
        {
          method: 'PUT',
          headers: auth(),
          body: JSON.stringify({
            activo: nuevoEstado
          })
        }
      )

      const datos = await respuesta.json()

      if (!respuesta.ok || !datos.ok) {
        throw new Error(
          datos.mensaje || 'No se pudo cambiar el estado del producto'
        )
      }

      alert(datos.mensaje)

      await cargarProductos()

    } catch (error) {
      console.error(
        'ERROR CAMBIANDO ESTADO PRODUCTO:',
        error
      )

      setError(
        error.message ||
        'No se pudo cambiar el estado del producto'
      )
    }
  }}
>
  {producto.activo === false
    ? 'Habilitar'
    : 'Deshabilitar'}
</button>

    {puedeTransferir && producto.activo !== false && <button className="table-action" type="button" onClick={() => abrirTransferencia(producto)}>Transferir</button>}

  </div>}
</td>

                  </tr>
                )
              })}

            </tbody>
	 </table>

          <div
  style={{
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '15px'
  }}
>
  <label>
    Mostrar:
  </label>

  <select
    value={productosPorPagina}
    onChange={(e) => {
      setProductosPorPagina(Number(e.target.value))
      setPaginaActual(1)
    }}
  >
    <option value={25}>25</option>
    <option value={50}>50</option>
    <option value={100}>100</option>
    <option value={200}>200</option>
  </select>

  <span>productos por página</span>
</div>

          {productosFiltrados.length === 0 && (
            <div className="empty-inventory">
              No se encontraron productos.
            </div>
          )}

          {productosFiltrados.length > 0 && <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', marginTop: '10px', marginBottom: '10px' }}>
            <button className="secondary-button" type="button" disabled={paginaActual === 1} onClick={() => setPaginaActual((pagina) => pagina - 1)}>← Anterior</button>
            <span>Página {paginaActual} de {totalPaginas} · {productosFiltrados.length} productos</span>
            <button className="secondary-button" type="button" disabled={paginaActual === totalPaginas} onClick={() => setPaginaActual((pagina) => pagina + 1)}>Siguiente →</button>
          </div>}

        </div>
      )}
{mostrarVistaExcel && (
  <div className="modal-overlay">

    <div className="modal-card">

      <div className="modal-header">

        <div>
          <h2>Vista previa de Excel</h2>

          <p>
            Se encontraron {excelVistaPrevia.length} productos.
            Revisa los datos antes de continuar.
          </p>
        </div>

        <button
          className="modal-close"
          type="button"
          onClick={() => {
            setMostrarVistaExcel(false)
            setExcelVistaPrevia([])
	    setError('')
          }}
        >
          ✕
        </button>

      </div>

      <div style={{ overflowX: 'auto' }}>

        <table className="inventory-table">

          <thead>
            <tr>
              {excelVistaPrevia.length > 0 &&
                Object.keys(excelVistaPrevia[0]).map((columna) => (
                  <th key={columna}>
                    {columna}
                  </th>
                ))}
            </tr>
          </thead>

          <tbody>

            {excelVistaPrevia.map((fila, indice) => (
              <tr key={indice}>

                {Object.keys(
                  excelVistaPrevia[0] || {}
                ).map((columna) => (
                  <td key={columna}>
                    {String(fila[columna] ?? '')}
                  </td>
                ))}

              </tr>
            ))}
              </tbody>

            </table>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
          marginTop: '20px'
        }}
      >

        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setMostrarVistaExcel(false)
            setExcelVistaPrevia([])
	    setError('')
          }}
        >
          Cancelar
        </button>

        <button
  className="primary-button"
  type="button"
  onClick={async () => {
    try {
      setError('')

      for (const fila of excelVistaPrevia) {
        const respuesta = await fetch(
          `${API}/productos`,
          {
            method: 'POST',
            headers: auth(),
            body: JSON.stringify({
              nombre: fila['Nombre'] || '',
              codigo_barras: fila['Código de barras'] || '',
              marca: fila['Marca'] || '',
              unidad: fila['Unidad'] || 'Unidad',
              precio_compra: Number(fila['Precio compra']) || 0,
              precio_venta: Number(fila['Precio venta']) || 0,
              stock_inicial: Number(fila['Stock actual']) || 0,
              stock_minimo: Number(fila['Stock mínimo']) || 0,
              sucursal_id: usuario.sucursal_id
            })
          }
        )

        const datos = await respuesta.json()

        if (!respuesta.ok || !datos.ok) {
          throw new Error(
            datos.mensaje || 'No se pudo importar un producto'
          )
        }
      }

      alert(
        `${excelVistaPrevia.length} productos importados correctamente.`
      )

      cerrarVistaExcel()
      await cargarProductos()

    } catch (error) {
      console.error('ERROR IMPORTANDO PRODUCTOS:', error)

      setError(
        error.message || 'No se pudieron importar los productos'
      )
    }
  }}
>
  Importar productos
</button>

      </div>

    </div>

  </div>
)}
      {mostrarNuevoProducto && (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(evento) => {
            if (evento.target === evento.currentTarget && !guardando) {
              limpiarFormulario()
              setMostrarNuevoProducto(false)
            }
          }}
        >

          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="producto-modal-titulo"
          >

            <div className="modal-header">

              <div>
                <h2 id="producto-modal-titulo">
  {productoEditando
    ? 'Editar producto'
    : 'Nuevo producto'}
</h2>

<p>
  {productoEditando
    ? 'Actualiza la información del producto.'
    : (modoCreacion ? 'El producto se creará con stock 0. La cantidad que registres en la compra será la única que se sumará al inventario.' : 'Registra un nuevo producto en el inventario.')}
</p>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={() => {
		limpiarFormulario()
    
		setProductoEditando(null)
		setMostrarNuevoProducto(false)
  
		}}
              >
                ✕
              </button>

            </div>

            {error && <div className="inventory-error" role="alert">{error}</div>}

            <datalist id="inventario-nombres-producto">
              {[...new Set(productos.map((producto) => producto.nombre).filter(Boolean))].map((nombre) => <option key={nombre} value={nombre} />)}
            </datalist>
            <datalist id="inventario-marcas-producto">
              {[...new Set(productos.map((producto) => producto.marca).filter(Boolean))].map((marca) => <option key={marca} value={marca} />)}
            </datalist>

            <form onSubmit={guardarNuevoProducto}>

              <div className="form-grid">

                <div className="form-group">
                  <label>Nombre *</label>

                  <input
                    ref={nombreProductoRef}
                    type="text"
                    list="inventario-nombres-producto"
                    value={nuevoProducto.nombre}
                    onChange={(e) =>
                      cambiarCampo(
                        'nombre',
                        e.target.value
                      )
                    }
                    placeholder="Ej. Leche PIL 1L"
                    required
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') {
                        return
                      }

                      e.preventDefault()
                      const valor = e.currentTarget.value.trim()

                      if (/^\d{4,}$/.test(valor) && !nuevoProducto.codigo_barras) {
                        cambiarCampo('codigo_barras', valor)
                        cambiarCampo('nombre', '')
                        codigoBarrasRef.current?.focus()
                      }
                    }}
                  />
                </div>

                <div className="form-group">
                  <label>Código de barras</label>

                  <input
                    ref={codigoBarrasRef}
                    type="text"
                    value={nuevoProducto.codigo_barras}
                    onChange={(e) =>
                      cambiarCampo(
                        'codigo_barras',
                        e.target.value
                      )
                    }
                    placeholder="Opcional"
                  />
                </div>

                <div className="form-group">
                  <label>Marca</label>

                  <input
                    type="text"
                    list="inventario-marcas-producto"
                    value={nuevoProducto.marca}
                    onChange={(e) =>
                      cambiarCampo(
                        'marca',
                        e.target.value
                      )
                    }
                    placeholder="Ej. PIL"
                  />
                </div>

                <div className="form-group">
                  <label>Unidad</label>

                  <select
                    value={nuevoProducto.unidad}
                    onChange={(e) =>
                      cambiarCampo(
                        'unidad',
                        e.target.value
                      )
                    }
                  >
                    <option value="Unidad">
  Unidad
</option>

<option value="Caja">
  Caja
</option>

<option value="Jaba">
  Jaba
</option>

<option value="Paquete">
  Paquete
</option>

<option value="Docena">
  Docena
</option>

<option value="Quintal">
  Quintal
</option>

<option value="Kg">
  Kg
</option>

<option value="Gramo">
  Gramo
</option>

<option value="Litro">
  Litro
</option>

<option value="Display">
  Display
</option>

<option value="Otro">
  Otro
</option>
                  </select>
                  <small>Elige la unidad mínima que controlarás. Para vender piezas y docenas, elige “Unidad” y agrega “Docena” con factor 12.</small>
                </div>

                <div className="form-group">
                  <label>Categoría</label>

<select
  value={nuevoProducto.categoria_id}
  onChange={(e) =>
    cambiarCampo(
      'categoria_id',
      e.target.value
    )
  }
>
  <option value="">
    Seleccionar categoría
  </option>

  <option value="1">
    Abarrotes
  </option>

  <option value="2">
    Bebidas
  </option>

  <option value="3">
    Lacteos
  </option>

  <option value="4">
    Limpieza
  </option>

  <option value="5">
    Snacks
  </option>
</select>
                </div>

                <div className="form-group">
                  <label>Proveedor</label>

<select
  value={nuevoProducto.proveedor_id}
  onChange={(e) =>
    cambiarCampo(
      'proveedor_id',
      e.target.value
    )
  }
>
  <option value="">
    Seleccionar proveedor
  </option>

  <option value="1">
    Distribuidora Central
  </option>

  <option value="2">
    Coca Cola Bolivia
  </option>

  <option value="3">
    Lacteos Bolivia
  </option>

  <option value="4">
    Importadora Tieri
  </option>

  <option value="5">
    Distribuidora Nacional
  </option>

</select>
                </div>

                <div className="form-group form-group-full">
                  {(() => {
                    const compraBase = Number(nuevoProducto.precio_compra || 0)
                    const ventaBase = Number(nuevoProducto.precio_venta || 0)
                    const gananciaBase = ventaBase - compraBase
                    const margenBase = compraBase > 0 ? (gananciaBase / compraBase) * 100 : 0
                    return (compraBase > 0 || ventaBase > 0) && <small style={{ color: gananciaBase >= 0 ? '#176b43' : '#bb5b4e', fontWeight: 600 }}>Ganancia base: {dinero(gananciaBase)} · {margenBase.toFixed(1)}%</small>
                  })()}
                </div>

                <div className="form-group form-group-full">
                  <label>Unidad base y presentaciones</label>
                  <small>La unidad base debe ser la menor unidad que controlas (idealmente factor 1, por ejemplo “Unidad”). Registra “Docena” como presentación con factor 12; cada presentación conserva sus propios precios.</small>
                  <div className="presentaciones-lista">
                    {nuevoProducto.presentaciones.map((presentacion, indice) => {
                      const costoSugerido = Number(nuevoProducto.precio_compra || 0) * Number(presentacion.factor || 0)
                      const esPresentacionBase = indice === indicePresentacionBase
                      const costo = presentacion.costo === '' ? costoSugerido : Number(presentacion.costo || 0)
                      const venta = presentacion.precio_venta === '' ? Number(nuevoProducto.precio_venta || 0) * Number(presentacion.factor || 0) : Number(presentacion.precio_venta || 0)
                      const ganancia = venta - costo
                      const margen = costo > 0 ? (ganancia / costo) * 100 : 0
                      return <div className="presentacion-fila" key={indice}>
                        <input value={presentacion.nombre} onChange={(e) => actualizarPresentacion(indice, 'nombre', e.target.value)} placeholder={esPresentacionBase ? nuevoProducto.unidad || 'Presentación principal' : 'Ej. Media caja (7 u)'} required />
                        <input type="number" min="1" step="1" value={presentacion.factor} onChange={(e) => actualizarPresentacion(indice, 'factor', e.target.value)} placeholder="Cantidad (ej. 15)" required />
                        <input type="number" min="0" step="any" value={presentacion.costo} onChange={(e) => actualizarPresentacion(indice, 'costo', e.target.value)} placeholder={esPresentacionBase ? 'Compra por unidad' : `Costo sugerido: ${costoSugerido.toFixed(2)}`} aria-label={`Precio de compra de ${presentacion.nombre || 'la presentación'}`} />
                        <input type="number" min="0" step="any" value={presentacion.precio_venta} onChange={(e) => actualizarPresentacion(indice, 'precio_venta', e.target.value)} placeholder={esPresentacionBase ? 'Venta por unidad' : `Venta sugerida: ${Number(nuevoProducto.precio_venta || 0) * Number(presentacion.factor || 0)}`} aria-label={`Precio de venta de ${presentacion.nombre || 'la presentación'}`} />
                        <span>{dinero(ganancia)} · {margen.toFixed(1)}%</span>
                        {nuevoProducto.presentaciones.length > 1 && <button className="secondary-button" type="button" onClick={() => eliminarPresentacion(indice)}>Quitar</button>}
                      </div>
                    })}
                  </div>
                  <button className="secondary-button" type="button" onClick={agregarPresentacion}>+ Agregar presentación</button>
                  <small>Ganancia = venta menos costo proporcional de compra.</small>
                </div>

                {modoCreacion
                  ? <div className="form-group"><label>Existencias</label><small>Se registran una sola vez en la cantidad de la compra. El producto se creará con stock 0.</small></div>
                  : <div className="form-group">
                    <label>Stock inicial</label>
                    <div className="presentacion-fila" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                      <input type="number" min="0" step="1" value={nuevoProducto.stock_inicial} onChange={(e) => cambiarCampo('stock_inicial', e.target.value)} placeholder="Cantidad" aria-label="Cantidad de presentaciones en stock" />
                      <select value={nuevoProducto.stock_inicial_presentacion} onChange={(e) => cambiarCampo('stock_inicial_presentacion', e.target.value)} aria-label="Presentación del stock inicial">
                        {nuevoProducto.presentaciones.map((presentacion, indice) => <option key={`${presentacion.nombre}-${indice}`} value={indice}>{presentacion.nombre} · {presentacion.factor} {nuevoProducto.unidad || 'unidades'}</option>)}
                      </select>
                      <input type="number" min="0" step="any" value={nuevoProducto.stock_inicial_unidades_sueltas} onChange={(e) => cambiarCampo('stock_inicial_unidades_sueltas', e.target.value)} placeholder={`Sueltas (${nuevoProducto.unidad || 'unid.'})`} aria-label="Unidades sueltas adicionales" />
                    </div>
                    <small>Equivale a {stockInicialConvertido} {nuevoProducto.unidad || 'unidades'} en el inventario de esta sucursal.</small>
                  </div>}

                <div className="form-group">
                  <label>Stock mínimo</label>

                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={nuevoProducto.stock_minimo}
                    onChange={(e) =>
                      cambiarCampo(
                        'stock_minimo',
                        e.target.value
                      )
                    }
                    placeholder="0"
                  />
                </div>

                <div className="form-group form-group-full">
                  <label>Descripción</label>

                  <textarea
                    value={nuevoProducto.descripcion}
                    onChange={(e) =>
                      cambiarCampo(
                        'descripcion',
                        e.target.value
                      )
                    }
                    placeholder="Descripción opcional del producto"
                    rows="3"
                  />
                </div>

                <div className="form-group form-group-full">
                  <label>Imagen de referencia</label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={seleccionarImagen}
                  />
                  {nuevoProducto.imagen_url && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
                      <img
                        className="producto-imagen-preview"
                        src={nuevoProducto.imagen_url}
                        alt="Vista previa del producto"
                      />
                      <button className="secondary-button" type="button" onClick={() => cambiarCampo('imagen_url', '')}>Quitar imagen</button>
                    </div>
                  )}
                </div>

              </div>

              <div className="modal-footer">

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
		    limpiarFormulario()	
		    setProductoEditando(null)
                    setMostrarNuevoProducto(false)
                  }}
                  disabled={guardando}
                >
                  Cancelar
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={guardando}
                >
                  {guardando
                    ? 'Guardando...'
                    : 'Guardar producto'}
                </button>

              </div>

            </form>

          </div>

        </div>
      )}

{mensajeExito && (
  <div className="modal-overlay">
    <div
      className="modal-card"
      style={{
        maxWidth: '420px',
        textAlign: 'center'
      }}
    >
      <div
        style={{
          fontSize: '48px',
          marginBottom: '12px'
        }}
      >
        ✓
      </div>

      <h2>Operación exitosa</h2>

      <p>{mensajeExito}</p>

      <button
        className="primary-button"
        type="button"
        onClick={() => setMensajeExito('')}
      >
        Aceptar
      </button>
    </div>
  </div>
)}

{transfiriendoProducto && (
  <div role="presentation" style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,22,0.45)', display: 'grid', placeItems: 'center', zIndex: 60 }} onClick={() => !guardandoTransferencia && setTransfiriendoProducto(null)}>
    <form role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={enviarTransferencia} style={{ background: '#fff', borderRadius: '14px', padding: '22px', width: '92%', maxWidth: '760px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h2 style={{ margin: 0 }}>Preparar ticket de transferencia</h2>
      {errorTransferencia && <div className="inventory-error" role="alert">{errorTransferencia}</div>}
      <p style={{ margin: 0, fontSize: '13px', color: '#5f6f68' }}>Al despachar, el stock sale de esta sucursal y queda en tránsito. La sucursal destino lo suma al confirmar recepción.</p>
      <label>Sucursal de destino
        <select value={sucursalDestinoTransferencia} onChange={(e) => setSucursalDestinoTransferencia(e.target.value)} required>
          <option value="">Selecciona una sucursal</option>
          {sucursales.filter((s) => s.activo && Number(s.id) !== Number(usuario.sucursal_id)).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </label>
      {lineasTransferencia.map((linea, indice) => {
        const producto = productos.find((item) => String(item.id) === String(linea.producto_id))
        const presentaciones = producto?.presentaciones?.length ? producto.presentaciones : [{ id: '', nombre: producto?.unidad || 'Unidad', factor: 1 }]
        const presentacion = presentaciones.find((item) => String(item.id || '') === String(linea.presentacion_id)) || presentaciones[0]
        return <div key={indice} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.5fr) minmax(110px, 1fr) 100px 100px auto', alignItems: 'end', gap: '8px', padding: '10px 0', borderBottom: '1px solid #eef2ef' }}>
          <label>Producto
            <select value={linea.producto_id} onChange={(e) => actualizarLineaTransferencia(indice, 'producto_id', e.target.value)} required>
              <option value="">Seleccionar producto</option>
              {productos.filter((item) => String(item.id) === String(linea.producto_id) || !lineasTransferencia.some((otra, posicion) => posicion !== indice && String(otra.producto_id) === String(item.id))).map((item) => <option key={item.id} value={item.id}>{item.nombre} · stock {Number(item.stock_actual || 0)}</option>)}
            </select>
          </label>
          <label>Presentación
            <select value={linea.presentacion_id} onChange={(e) => actualizarLineaTransferencia(indice, 'presentacion_id', e.target.value)}>{presentaciones.map((item, pos) => <option key={item.id || pos} value={String(item.id || '')}>{item.nombre}</option>)}</select>
          </label>
          <label>Cantidad
            <input type="number" min="0" step="1" value={linea.cantidad_presentacion} onChange={(e) => actualizarLineaTransferencia(indice, 'cantidad_presentacion', e.target.value)} />
          </label>
          <label>Sueltas
            <input type="number" min="0" step="any" value={linea.unidades_sueltas} onChange={(e) => actualizarLineaTransferencia(indice, 'unidades_sueltas', e.target.value)} />
          </label>
          {lineasTransferencia.length > 1 && <button type="button" className="secondary-button" onClick={() => setLineasTransferencia((anteriores) => anteriores.filter((_, pos) => pos !== indice))}>Quitar</button>}
          <small style={{ gridColumn: '1 / -1', color: '#5f6f68' }}>Equivale a {(Number(linea.cantidad_presentacion) || 0) * Number(presentacion?.factor || 1) + (Number(linea.unidades_sueltas) || 0)} unidades base · disponible {Number(producto?.stock_actual || 0)}</small>
        </div>
      })}
      <button type="button" className="secondary-button" style={{ alignSelf: 'flex-start' }} onClick={() => setLineasTransferencia((anteriores) => [...anteriores, { producto_id: '', presentacion_id: '', cantidad_presentacion: '1', unidades_sueltas: '' }])}>+ Agregar producto</button>
      <label>Nota (opcional)
        <input value={notaTransferencia} onChange={(e) => setNotaTransferencia(e.target.value)} placeholder="Ej. Reposición pedida por la otra tienda" />
      </label>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
        <button className="secondary-button" type="button" onClick={() => setTransfiriendoProducto(null)} disabled={guardandoTransferencia}>Cancelar</button>
        <button className="primary-button" type="submit" disabled={guardandoTransferencia}>{guardandoTransferencia ? 'Creando ticket…' : 'Despachar y crear ticket'}</button>
      </div>
    </form>
  </div>
)}

{mostrarHistorialTransferencias && (
  <div role="presentation" style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,22,0.45)', display: 'grid', placeItems: 'center', zIndex: 60 }} onClick={() => setMostrarHistorialTransferencias(false)}>
    <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '8px', padding: '22px', width: '92%', maxWidth: '760px', maxHeight: '86vh', overflowY: 'auto' }}>
      <h2 style={{ marginTop: 0 }}>Transferencias y recepción</h2>
      {errorTransferencia && <div className="inventory-error" role="alert">{errorTransferencia}</div>}
      <form onSubmit={(evento) => { evento.preventDefault(); buscarTicketPorCodigo() }} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input autoFocus value={codigoBusquedaTransferencia} onChange={(e) => setCodigoBusquedaTransferencia(e.target.value.toUpperCase())} placeholder="Escanea o escribe el código del ticket" aria-label="Código del ticket de transferencia" />
        <button className="primary-button" type="submit">Buscar ticket</button>
      </form>
      {!historialTransferencias.length && <p style={{ color: '#5f6f68' }}>Todavía no hay tickets de transferencia registrados.</p>}
      <div style={{ display: 'grid', gap: '10px' }}>
        {historialTransferencias.map((ticket) => {
          const esOrigen = Number(ticket.sucursal_origen_id) === Number(usuario.sucursal_id)
          const esDestino = Number(ticket.sucursal_destino_id) === Number(usuario.sucursal_id)
          const estado = { en_transito: 'En tránsito', recibida: 'Recibida', recibida_con_diferencia: 'Recibida con diferencia', anulada: 'Anulada', historica: 'Histórica' }[ticket.estado] || ticket.estado
          return <article key={ticket.id} style={{ padding: '12px', border: '1px solid #dfe9e4', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
              <div><strong>{ticket.codigo}</strong><small style={{ display: 'block', color: '#687b72' }}>{new Date(ticket.fecha).toLocaleString()} · {ticket.sucursal_origen} → {ticket.sucursal_destino} · {estado}</small></div>
              {ticket.estado === 'en_transito' && <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {esDestino && <button className="primary-button" type="button" onClick={() => abrirRecepcion(ticket)}>Recibir</button>}
                {esOrigen && <button className="secondary-button" type="button" onClick={() => anularTransferencia(ticket)}>Anular saldo pendiente</button>}
              </div>}
              {ticket.estado !== 'historica' && <button className="secondary-button" type="button" onClick={() => setTicketImpresion(ticket)}>Imprimir ticket</button>}
            </div>
            <ul style={{ margin: '8px 0', paddingLeft: '20px', color: '#53655e', fontSize: '12px' }}>
              {ticket.items.map((item, indice) => <li key={item.id || `${ticket.id}-${indice}`}>{item.producto || item.nombre}: {Number(item.cantidad_recibida || 0)} / {Number(item.cantidad)} unidades recibidas</li>)}
            </ul>
            {ticket.nota && <small style={{ color: '#687b72' }}>Nota: {ticket.nota}</small>}
            {ticket.nota_recepcion && <small style={{ display: 'block', color: '#687b72' }}>Recepción: {ticket.nota_recepcion}</small>}
            {ticket.recepciones?.map((recepcion, indice) => <small key={`${ticket.id}-recepcion-${indice}`} style={{ display: 'block', marginTop: '5px', color: '#53655e' }}>Recepción {new Date(recepcion.fecha).toLocaleString()} · {recepcion.usuario || 'Usuario'}{recepcion.nota ? ` · ${recepcion.nota}` : ''}: {recepcion.items.map((item) => `${ticket.items.find((linea) => linea.id === item.ticket_item_id)?.producto || 'Producto'} ${Number(item.cantidad)}`).join(', ') || 'sin unidades recibidas'}</small>)}
          </article>
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
        <button className="secondary-button" type="button" onClick={() => setMostrarHistorialTransferencias(false)}>Cerrar</button>
      </div>
    </div>
  </div>
)}

{ticketEnRecepcion && (
  <div role="presentation" style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,22,0.55)', display: 'grid', placeItems: 'center', zIndex: 70 }} onClick={() => !guardandoRecepcion && setTicketEnRecepcion(null)}>
    <form role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={confirmarRecepcionTransferencia} style={{ background: '#fff', borderRadius: '8px', padding: '22px', width: '92%', maxWidth: '620px', maxHeight: '85vh', overflowY: 'auto' }}>
      <h2 style={{ marginTop: 0 }}>Recibir {ticketEnRecepcion.codigo}</h2>
      {errorTransferencia && <div className="inventory-error" role="alert">{errorTransferencia}</div>}
      <p>{ticketEnRecepcion.sucursal_origen} → {ticketEnRecepcion.sucursal_destino}. Ingresa solo las unidades que llegaron y verificaste.</p>
      {lineasRecepcion.map((linea, indice) => <label key={linea.item_id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
        <span>{linea.producto} · {linea.presentacion_nombre}<small style={{ display: 'block', color: '#687b72' }}>Pendiente: {linea.cantidad - (Number(ticketEnRecepcion.items.find((item) => item.id === linea.item_id)?.cantidad_recibida) || 0)} unidades base</small></span>
        <input type="number" min="0" step="any" max={linea.cantidad - (Number(ticketEnRecepcion.items.find((item) => item.id === linea.item_id)?.cantidad_recibida) || 0)} value={linea.cantidad_recibida} onChange={(e) => setLineasRecepcion((anteriores) => anteriores.map((item, posicion) => posicion === indice ? { ...item, cantidad_recibida: e.target.value } : item))} aria-label={`Cantidad recibida de ${linea.producto}`} />
      </label>)}
      <label>Observación / diferencia<textarea value={notaRecepcion} onChange={(e) => setNotaRecepcion(e.target.value)} rows="2" placeholder="Faltantes, daños u observaciones" /></label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap', marginTop: '14px' }}>
        <button type="button" className="secondary-button" onClick={() => setTicketEnRecepcion(null)} disabled={guardandoRecepcion}>Cancelar</button>
        <button type="submit" className="secondary-button" disabled={guardandoRecepcion}>Guardar recepción parcial</button>
        <button type="button" className="primary-button" disabled={guardandoRecepcion} onClick={() => confirmarRecepcionTransferencia(null, true)}>Cerrar con diferencia</button>
      </div>
    </form>
  </div>
)}

{ticketImpresion && (
  createPortal(
    <div role="presentation" className="transferencia-ticket-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,22,0.45)', display: 'grid', placeItems: 'center', zIndex: 80 }} onClick={() => setTicketImpresion(null)}>
      <article role="dialog" aria-modal="true" className="transferencia-ticket" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '8px', padding: '24px', width: '92%', maxWidth: '420px', textAlign: 'center' }}>
        <h2>Ticket de traslado</h2>
        <strong>{ticketImpresion.codigo}</strong>
        <CodigoBarrasTransferencia codigo={ticketImpresion.codigo} />
        <p>{ticketImpresion.sucursal_origen} → {ticketImpresion.sucursal_destino}</p>
        <ul style={{ textAlign: 'left' }}>{ticketImpresion.items.map((item, indice) => <li key={item.producto_id || indice}>{productos.find((producto) => producto.id === Number(item.producto_id))?.nombre || item.producto || 'Producto'}: {Number(item.cantidad)} unidades base</li>)}</ul>
        <p>Estado: En tránsito · Stock descontado del origen</p>
        <div className="transferencia-ticket-actions" style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}><button className="secondary-button" type="button" onClick={() => setTicketImpresion(null)}>Cerrar</button><button className="primary-button" type="button" onClick={imprimirTicketTraslado}>Imprimir ticket</button></div>
      </article>
    </div>,
    document.body,
  )
)}
    </section>
  )
}

export default Inventario
