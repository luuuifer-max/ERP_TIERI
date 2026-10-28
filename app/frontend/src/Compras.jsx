import { useEffect, useRef, useState } from 'react'
import Inventario from './Inventario'
import { API } from './api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('tieri_token') || ''}`, 'Content-Type': 'application/json' })
const dinero = (valor) => `Bs ${Number(valor || 0).toFixed(2)}`

const itemVacio = { producto_id: '', presentacion_id: '', cantidad_presentacion: '', costo_unitario: '', descuento_unitario: '' }

function Compras({ usuario }) {
  const esAdmin = [1, '1'].includes(usuario?.rol_id) || ['dueño', 'dueno', 'propietario', 'admin', 'administrador', 'gerente general'].includes(String(usuario?.rol || '').toLowerCase())
  const puedeCrear = esAdmin || usuario?.permisos?.includes('compras.crear')
  const puedeCrearProducto = esAdmin || usuario?.permisos?.includes('inventario.crear')
  const puedeEditarProducto = esAdmin || usuario?.permisos?.includes('inventario.editar')

  const [productos, setProductos] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [proveedorId, setProveedorId] = useState('')
  const [numeroFactura, setNumeroFactura] = useState('')
  const [observacion, setObservacion] = useState('')
  const [items, setItems] = useState([{ ...itemVacio }])
  const cantidadCompraRefs = useRef({})

  const [mostrarNuevoProveedor, setMostrarNuevoProveedor] = useState(false)
  const [nuevoProveedor, setNuevoProveedor] = useState({ nombre: '', empresa: '', telefono: '' })

  // Cuando no es null, se abre el MISMO formulario de "Nuevo producto" de Inventario.
  const [creando, setCreando] = useState(null)
  // Al elegir un producto que ya existe, se abre su ficha completa (el mismo formulario de Inventario)
  // para revisar/cambiar precios de compra y venta antes de registrar la compra.
  const [abrirFichaAlElegir, setAbrirFichaAlElegir] = useState(true)
  const [fichasVistas, setFichasVistas] = useState({})

  const abrirFichaDe = (indice, producto) => {
    if (!abrirFichaAlElegir || !puedeEditarProducto || fichasVistas[indice] === producto.id) return
    setFichasVistas((anterior) => ({ ...anterior, [indice]: producto.id }))
    setCreando({ fila: indice, nombre: '', producto })
  }

  const recargarProductos = async () => {
    const respuesta = await fetch(`${API}/productos?sucursal_id=${usuario.sucursal_id}`, { headers: auth() })
    const datos = await respuesta.json()
    if (!datos.ok) return []
    setProductos(datos.productos || [])
    return datos.productos || []
  }

  const cargar = async () => {
    setCargando(true)
    setError('')
    try {
      const [proveedoresResp, historialResp] = await Promise.all([
        fetch(`${API}/proveedores`, { headers: auth() }),
        fetch(`${API}/compras?sucursal_id=${usuario.sucursal_id}`, { headers: auth() })
      ])
      await recargarProductos()
      const proveedoresDatos = await proveedoresResp.json()
      const historialDatos = await historialResp.json()
      if (proveedoresDatos.ok) setProveedores(proveedoresDatos.proveedores || [])
      if (historialDatos.ok) setHistorial(historialDatos.compras || [])
      const fallos = [proveedoresDatos, historialDatos].filter((d) => !d.ok).map((d) => d.mensaje).filter(Boolean)
      if (fallos.length) setError(fallos.join(' · '))
    } catch (err) {
      setError(err.message || 'No se pudo cargar Compras')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [usuario.sucursal_id])

  const actualizarItem = (indice, campo, valor) => {
    setItems((anterior) => anterior.map((item, i) => {
      if (i !== indice) return item
      const actualizado = { ...item, [campo]: valor }
      if (campo === 'presentacion_id') {
        actualizado.descuento_unitario = ''
        const producto = productos.find((p) => String(p.id) === String(actualizado.producto_id))
        const presentacion = producto?.presentaciones?.find((p) => String(p.id) === String(valor))
        if (presentacion) {
          actualizado.presentacion_nombre = presentacion.nombre
          actualizado.factor_presentacion = Number(presentacion.factor) || 1
          actualizado.costo_unitario = String(presentacion.costo ?? producto.precio_compra_actual ?? '')
        }
      }
      return actualizado
    }))
  }

  const buscarProductoPorNombre = (indice, textoOriginal, esTecleo = true) => {
    const texto = textoOriginal.toUpperCase()
    const coincidencia = productos.find((p) => p.nombre.toLowerCase() === texto.toLowerCase())
    setItems((anterior) => anterior.map((item, i) => {
      if (i !== indice) return item
      if (coincidencia) {
        const presentacion = coincidencia.presentaciones?.[0]
        return { ...item, producto_id: coincidencia.id, producto_texto: texto, presentacion_id: presentacion?.id || '', presentacion_nombre: presentacion?.nombre || coincidencia.unidad || 'Unidad', factor_presentacion: Number(presentacion?.factor) || 1, costo_unitario: String(presentacion?.costo ?? coincidencia.precio_compra_actual ?? ''), descuento_unitario: '' }
      }
      return { ...item, producto_id: '', producto_texto: texto, descuento_unitario: '' }
    }))
    // Si lo eligió de la lista (no tecleando letra por letra), abre la ficha completa.
    if (coincidencia && !esTecleo) abrirFichaDe(indice, coincidencia)
  }

  // Se llama cuando el formulario de Inventario guardó el producto nuevo.
  const alCrearProducto = async (productoCreado) => {
    const fila = creando?.fila ?? 0
    const lista = await recargarProductos()
    const completo = lista.find((p) => String(p.id) === String(productoCreado.id)) || productoCreado
    const presentacion = completo?.presentaciones?.[0]
    setItems((anterior) => anterior.map((item, i) => i === fila ? { ...item, producto_id: productoCreado.id, producto_texto: productoCreado.nombre, presentacion_id: presentacion?.id || '', presentacion_nombre: presentacion?.nombre || completo?.unidad || 'Unidad', factor_presentacion: Number(presentacion?.factor) || 1, costo_unitario: String(presentacion?.costo ?? completo?.precio_compra_actual ?? '') } : item))
    const eraEdicion = !!creando?.producto
    setCreando(null)
    requestAnimationFrame(() => cantidadCompraRefs.current[fila]?.focus())
    setMensaje(eraEdicion ? `Producto "${productoCreado.nombre}" actualizado.` : `Producto "${productoCreado.nombre}" creado. Ahora indica la cantidad comprada.`)
  }

  const agregarItem = () => setItems((anterior) => [...anterior, { ...itemVacio }])
  const quitarItem = (indice) => setItems((anterior) => anterior.length > 1 ? anterior.filter((_, i) => i !== indice) : anterior)

  const totalCompra = items.reduce((total, item) => total + (Number(item.cantidad_presentacion) || 0) * Math.max(0, (Number(item.costo_unitario) || 0) - (Number(item.descuento_unitario) || 0)), 0)

  const crearProveedor = async (evento) => {
    evento.preventDefault()
    try {
      const respuesta = await fetch(`${API}/proveedores`, { method: 'POST', headers: auth(), body: JSON.stringify(nuevoProveedor) })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo crear el proveedor')
      setProveedores((anterior) => [...anterior, datos.proveedor])
      setProveedorId(datos.proveedor.id)
      setMostrarNuevoProveedor(false)
      setNuevoProveedor({ nombre: '', empresa: '', telefono: '' })
    } catch (err) {
      setError(err.message || 'No se pudo crear el proveedor')
    }
  }

  const registrarCompra = async (evento) => {
    evento.preventDefault()
    setGuardando(true)
    setError('')
    try {
      const lineaSinProducto = items.find((item) => item.producto_texto && !item.producto_id)
      if (lineaSinProducto) throw new Error(`"${lineaSinProducto.producto_texto}" no está vinculado al inventario. Selecciónalo de nuevo o créalo desde esta línea.`)
      const lineaSinCantidad = items.find((item) => item.producto_id && !(Number(item.cantidad_presentacion) > 0))
      if (lineaSinCantidad) throw new Error(`Indica cuántas unidades o presentaciones de ${lineaSinCantidad.producto_texto || 'el producto'} compraste (mínimo 1); esa cantidad se sumará al inventario al guardar.`)
      const itemsValidos = items.filter((item) => item.producto_id && Number(item.cantidad_presentacion) > 0)
      if (!itemsValidos.length) throw new Error('Agrega una línea, selecciona un producto y escribe la cantidad comprada.')
      if (itemsValidos.some((item) => (Number(item.descuento_unitario) || 0) > (Number(item.costo_unitario) || 0))) throw new Error('El descuento por presentación no puede ser mayor que su costo')
      const payload = {
        proveedor_id: proveedorId || null,
        sucursal_id: usuario.sucursal_id,
        numero_factura: numeroFactura,
        observacion,
        items: itemsValidos.map((item) => {
          const producto = productos.find((p) => String(p.id) === String(item.producto_id))
          const presentacion = producto?.presentaciones?.find((p) => String(p.id) === String(item.presentacion_id)) || producto?.presentaciones?.[0] || { id: item.presentacion_id, nombre: item.presentacion_nombre || producto?.unidad || 'Unidad', factor: item.factor_presentacion || 1 }
          return {
            producto_id: Number(item.producto_id),
            presentacion_id: Number(presentacion.id) || null,
            cantidad_presentacion: Number(item.cantidad_presentacion),
            presentacion_nombre: presentacion.nombre,
            factor_presentacion: presentacion.factor || 1,
            costo_unitario: Number(item.costo_unitario) || 0,
            descuento_unitario: Number(item.descuento_unitario) || 0
          }
        })
      }
      const respuesta = await fetch(`${API}/compras`, { method: 'POST', headers: auth(), body: JSON.stringify(payload) })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo registrar la compra')
      setMensaje(datos.mensaje)
      setItems([{ ...itemVacio }])
      setNumeroFactura('')
      setObservacion('')
      await cargar()
    } catch (err) {
      setError(err.message || 'No se pudo registrar la compra')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <div className="admin-message">Cargando Compras...</div>

  return <section className="admin-page">
    <div className="admin-heading">
      <div><span className="ventas-kicker">ENTRADA DE MERCADERÍA</span><h2>Compras</h2><p>Registrar una compra suma el stock automáticamente y actualiza el precio de compra del producto. Para correcciones puntuales sigue existiendo la edición manual en Inventario.</p></div>
    </div>
    {error && <div className="ventas-error">{error}</div>}{mensaje && <div className="ventas-success">{mensaje}</div>}

    {!puedeCrear && <div className="ventas-error">No tienes permiso para registrar compras. Puedes ver el historial abajo.</div>}

    {puedeCrear && <form className="admin-card" onSubmit={registrarCompra} style={{ marginBottom: '20px' }}>
      <h3>Nueva compra</h3>
      <div className="admin-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <label>Proveedor (opcional)
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Sin proveedor / no registrado</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.empresa ? ` · ${p.empresa}` : ''}</option>)}
          </select>
        </label>
        <label>N° de factura/recibo (opcional)<input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} /></label>
      </div>
      <button type="button" className="secondary-button" style={{ width: 'fit-content' }} onClick={() => setMostrarNuevoProveedor(!mostrarNuevoProveedor)}>{mostrarNuevoProveedor ? 'Cancelar' : '+ Proveedor nuevo rápido'}</button>
      {mostrarNuevoProveedor && <div className="admin-edit-row">
        <input placeholder="Nombre" value={nuevoProveedor.nombre} onChange={(e) => setNuevoProveedor({ ...nuevoProveedor, nombre: e.target.value })} />
        <input placeholder="Empresa (opcional)" value={nuevoProveedor.empresa} onChange={(e) => setNuevoProveedor({ ...nuevoProveedor, empresa: e.target.value })} />
        <input placeholder="Teléfono (opcional)" value={nuevoProveedor.telefono} onChange={(e) => setNuevoProveedor({ ...nuevoProveedor, telefono: e.target.value })} />
        <button className="ventas-button ventas-button-primary" type="button" onClick={crearProveedor}>Guardar proveedor</button>
      </div>}

      <h4 style={{ marginTop: '14px' }}>Productos comprados</h4>
      {puedeCrearProducto && <button type="button" className="primary-button" style={{ width: 'fit-content', marginBottom: '12px', fontSize: '14px', fontWeight: 800 }} onClick={() => setCreando({ fila: items.length - 1, nombre: '' })}>+ Producto nuevo (no está en inventario)</button>}
      {puedeEditarProducto && <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#5f6f68' }}><input type="checkbox" checked={abrirFichaAlElegir} onChange={(e) => setAbrirFichaAlElegir(e.target.checked)} style={{ width: 'auto' }} />Abrir la ficha completa (precios de compra y venta, presentaciones) al elegir un producto existente</label>}
      <datalist id="compras-productos-lista">
        {productos.map((p) => <option key={p.id} value={p.nombre} />)}
      </datalist>
      {items.map((item, indice) => {
        const producto = productos.find((p) => String(p.id) === String(item.producto_id))
        const presentaciones = producto?.presentaciones?.length ? producto.presentaciones : (producto ? [{ id: '', nombre: producto.unidad || 'Unidad', factor: 1 }] : [])
        const textoActual = item.producto_texto ?? (producto?.nombre || '')
        const presSel = presentaciones.find((p) => String(p.id || '') === String(item.presentacion_id)) || presentaciones[0]
        const costoNuevo = Number(item.costo_unitario) || 0
        const descuentoNuevo = Number(item.descuento_unitario) || 0
        const costoNetoNuevo = Math.max(0, costoNuevo - descuentoNuevo)
        const cantidadNum = Number(item.cantidad_presentacion) || 0
        const ventaActual = presSel?.precio_venta != null ? Number(presSel.precio_venta) : (presentaciones.length === 1 && producto?.precio_venta_actual != null ? Number(producto.precio_venta_actual) : null)
        const costoAnterior = presSel?.costo != null ? Number(presSel.costo) : null
        const cambioCosto = costoAnterior > 0 && costoNetoNuevo > 0 ? ((costoNetoNuevo - costoAnterior) / costoAnterior) * 100 : null
        return <div key={indice}>
          <div className="presentacion-fila" style={{ gridTemplateColumns: '1.5fr .9fr .7fr .8fr .8fr auto' }}>
            <input list="compras-productos-lista" style={{ textTransform: 'uppercase' }} placeholder="Escribe para buscar (ej. A, AC...)" value={textoActual} onChange={(e) => buscarProductoPorNombre(indice, e.target.value, ['insertText', 'deleteContentBackward', 'deleteContentForward', 'deleteByCut', 'insertCompositionText'].includes(e.nativeEvent?.inputType))} onBlur={() => { if (producto) abrirFichaDe(indice, producto) }} required />
            <select value={item.presentacion_id} onChange={(e) => actualizarItem(indice, 'presentacion_id', e.target.value)} disabled={!presentaciones.length}>
              {presentaciones.map((p) => <option key={p.id || p.nombre} value={p.id || ''}>{p.nombre}</option>)}
            </select>
            <input ref={(elemento) => { cantidadCompraRefs.current[indice] = elemento }} type="number" min="1" step="1" placeholder="Cantidad" value={item.cantidad_presentacion} onChange={(e) => actualizarItem(indice, 'cantidad_presentacion', e.target.value)} required />
            <input type="number" min="0" step="any" placeholder={`Costo ${presSel?.nombre || 'presentación'}`} title="Costo bruto de una presentación, antes del descuento de proveedor" value={item.costo_unitario} onChange={(e) => actualizarItem(indice, 'costo_unitario', e.target.value)} required />
            <input type="number" min="0" step="any" max={item.costo_unitario || undefined} placeholder="Desc. unitario" title="Descuento del proveedor por cada presentación comprada" value={item.descuento_unitario} onChange={(e) => actualizarItem(indice, 'descuento_unitario', e.target.value)} />
            <button type="button" className="secondary-button" onClick={() => quitarItem(indice)}>Quitar</button>
          </div>
          {producto && <small style={{ color: '#5f6f68', display: 'block', margin: '2px 0 8px' }}>
            Subtotal neto: <b>{dinero(cantidadNum * costoNetoNuevo)}</b> ({cantidadNum} × {dinero(costoNuevo)} − {dinero(descuentoNuevo)} por {presSel?.nombre || 'presentación'})
            {costoAnterior != null && costoNuevo > 0 && <> · Costo anterior: {dinero(costoAnterior)}{cambioCosto !== null && Math.abs(cambioCosto) >= 0.05 ? ` (${cambioCosto > 0 ? 'sube' : 'baja'} ${Math.abs(cambioCosto).toFixed(1)}%)` : ' (sin cambio)'}</>}
            {ventaActual != null && costoNetoNuevo > 0 && <> · Venta actual: {dinero(ventaActual)} · Ganancia: <b style={{ color: ventaActual - costoNetoNuevo >= 0 ? '#176b43' : '#bb5b4e' }}>{dinero(ventaActual - costoNetoNuevo)} ({(((ventaActual - costoNetoNuevo) / costoNetoNuevo) * 100).toFixed(1)}%)</b></>}
            {puedeEditarProducto && <> <button type="button" className="secondary-button" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => setCreando({ fila: indice, nombre: '', producto })}>Editar ficha completa</button></>}
          </small>}
          {textoActual && !producto && <small style={{ color: '#bb5b4e' }}>
            "{textoActual}" no existe en el inventario todavía.
            {puedeCrearProducto && <> <button type="button" className="secondary-button" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => setCreando({ fila: indice, nombre: textoActual })}>Crearlo ahora</button></>}
          </small>}
        </div>
      })}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" className="secondary-button" style={{ width: 'fit-content' }} onClick={agregarItem}>+ Agregar otra línea</button>
      </div>

      <label>Observación (opcional)<input value={observacion} onChange={(e) => setObservacion(e.target.value)} /></label>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
        <strong>Total: {dinero(totalCompra)}</strong>
        <button className="ventas-button ventas-button-primary" type="submit" disabled={guardando}>{guardando ? 'Registrando…' : 'Registrar compra'}</button>
      </div>
    </form>}

    <div className="admin-card">
      <h3>Historial de compras</h3>
      <div className="admin-list">
        {!historial.length && <small style={{ color: '#8b9992' }}>Todavía no hay compras registradas.</small>}
        {historial.map((c) => <div className="admin-list-item admin-list-item-column" key={c.id}>
          <div className="admin-item-row">
            <div><strong>{c.proveedor_nombre || 'Sin proveedor'}</strong><small>{new Date(c.fecha).toLocaleString()} · {c.usuario_nombre || 'Usuario'}{c.numero_factura ? ` · Factura ${c.numero_factura}` : ''}</small></div>
            <strong>{dinero(c.total)}</strong>
          </div>
          {c.observacion && <small style={{ display: 'block', margin: '4px 0 8px', color: '#5f6f68' }}>Detalle: {c.observacion}</small>}
          <div className="admin-sucursal-usuarios">
            {c.items.map((it, i) => <span className="admin-badge" key={i}>{it.cantidad_presentacion} {it.presentacion_nombre} de {it.nombre}{it.costo_presentacion != null ? ` · ${dinero(it.costo_presentacion)} neto c/u` : ''}{Number(it.descuento_presentacion) > 0 ? ` · desc. ${dinero(it.descuento_presentacion)} c/u` : ''}</span>)}
          </div>
        </div>)}
      </div>
    </div>

    {creando && <Inventario usuario={usuario} modoCreacion nombreInicial={creando.nombre} productoParaEditar={creando.producto || null} onProductoCreado={alCrearProducto} onCancelarCreacion={() => setCreando(null)} />}
  </section>
}

export default Compras
