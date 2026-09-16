import { useEffect, useState } from 'react'

const API = 'http://localhost:3000/api'
const METODOS = ['EFECTIVO', 'QR', 'TARJETA', 'TRANSFERENCIA', 'OTROS']

const dinero = (valor) => `Bs ${Number(valor || 0).toFixed(2)}`

function Caja({ usuario }) {
  const [estado, setEstado] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)
  const [formulario, setFormulario] = useState({
    monto: '',
    tipo: 'ingreso',
    metodo: 'EFECTIVO',
    concepto: '',
    observacion: ''
  })

  const cargarEstado = async () => {
    try {
      setCargando(true)
      setError('')
      const respuesta = await fetch(`${API}/caja/estado?sucursal_id=${usuario.sucursal_id}`)
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo cargar Caja')
      setEstado(datos)
    } catch (err) {
      setError(err.message || 'Error conectando con Caja')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarEstado()
  }, [])

  const cambiarFormulario = (campo, valor) => {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  const cerrarModal = () => {
    setModal(null)
    setFormulario({ monto: '', tipo: 'ingreso', metodo: 'EFECTIVO', concepto: '', observacion: '' })
  }

  const enviarAccion = async (evento) => {
    evento.preventDefault()
    setGuardando(true)
    setError('')

    try {
      let ruta = '/caja/movimientos'
      let cuerpo = {
        usuario_id: usuario.id,
        sucursal_id: usuario.sucursal_id,
        caja_id: estado?.caja?.id,
        monto: Number(formulario.monto),
        tipo: formulario.tipo,
        metodo: formulario.metodo,
        concepto: formulario.concepto
      }

      if (modal === 'apertura') {
        ruta = '/caja/apertura'
        cuerpo = { usuario_id: usuario.id, sucursal_id: usuario.sucursal_id, monto_inicial: Number(formulario.monto) }
      }

      if (modal === 'cierre') {
        ruta = '/caja/cierre'
        cuerpo = {
          usuario_id: usuario.id,
          sucursal_id: usuario.sucursal_id,
          caja_id: estado?.caja?.id,
          monto_contado: Number(formulario.monto),
          observacion: formulario.observacion
        }
      }

      const respuesta = await fetch(`${API}${ruta}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo)
      })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo completar la operación')

      cerrarModal()
      await cargarEstado()
    } catch (err) {
      setError(err.message || 'No se pudo completar la operación')
    } finally {
      setGuardando(false)
    }
  }

  const resumen = estado?.resumen || {}
  const abierta = Boolean(estado?.caja)
  const diferencia = Number(resumen.diferencia || 0)
  const claseDiferencia = diferencia === 0 ? 'caja-verde' : Math.abs(diferencia) <= 5 ? 'caja-naranja' : 'caja-roja'

  if (cargando) return <div className="caja-message">Cargando estado de caja...</div>

  return (
    <section className="caja-page">
      <div className="caja-top">
        <div>
          <span className="caja-kicker">CONTROL DIARIO</span>
          <h2>Caja</h2>
          <p>{abierta ? `Abierta por ${estado.caja.usuario_nombre || 'el usuario actual'}` : 'No hay una caja abierta para esta sucursal.'}</p>
        </div>
        <div className={`caja-status ${abierta ? 'abierta' : 'cerrada'}`}>
          <span /> {abierta ? 'Caja abierta' : 'Caja cerrada'}
        </div>
      </div>

      {error && <div className="caja-error">{error}</div>}

      {!abierta ? (
        <div className="caja-empty">
          <div className="caja-empty-icon">$</div>
          <h3>Comienza la jornada</h3>
          <p>Registra el efectivo inicial para habilitar el control de ventas y movimientos.</p>
          <button className="caja-button caja-button-primary" onClick={() => setModal('apertura')}>Abrir caja</button>
        </div>
      ) : (
        <>
          <div className="caja-actions">
            <button className="caja-button caja-button-secondary" onClick={() => setModal('movimiento')}>+ Registrar movimiento</button>
            <button className="caja-button caja-button-secondary caja-print-button" onClick={() => window.print()}>Imprimir reporte</button>
            <button className="caja-button caja-button-danger" onClick={() => setModal('cierre')}>Cerrar caja</button>
          </div>

          <div className="caja-metricas">
            <article className="caja-metrica caja-verde"><span>Ventas del día</span><strong>{dinero(resumen.total_ventas)}</strong><small>{resumen.cantidad_ventas || 0} operaciones</small></article>
            <article className="caja-metrica caja-verde"><span>Efectivo</span><strong>{dinero(resumen.efectivo)}</strong><small>Ingresos en efectivo</small></article>
            <article className="caja-metrica caja-naranja"><span>Pagos digitales</span><strong>{dinero(Number(resumen.qr || 0) + Number(resumen.tarjeta || 0) + Number(resumen.transferencia || 0))}</strong><small>QR, tarjeta y transferencia</small></article>
            <article className="caja-metrica caja-roja"><span>Egresos</span><strong>{dinero(resumen.egresos)}</strong><small>Movimientos registrados</small></article>
            <article className={`caja-metrica ${claseDiferencia}`}><span>Saldo esperado</span><strong>{dinero(resumen.efectivo_esperado)}</strong><small>Diferencia actual: {dinero(diferencia)}</small></article>
          </div>

          <section className="caja-panel">
            <div className="caja-panel-heading"><div><h3>Resumen por método de pago</h3><p>Ventas registradas desde la apertura actual.</p></div><button className="caja-refresh" onClick={cargarEstado}>Actualizar</button></div>
            <div className="caja-metodos">
              {METODOS.map((metodo) => <div className="caja-metodo" key={metodo}><span>{metodo}</span><strong>{dinero(resumen[metodo.toLowerCase()] || 0)}</strong></div>)}
            </div>
          </section>

          <section className="caja-panel caja-info-panel">
            <div><span>Saldo inicial</span><strong>{dinero(estado.caja.monto_inicial)}</strong></div>
            <div><span>Apertura</span><strong>{new Date(estado.caja.fecha_apertura).toLocaleString()}</strong></div>
            <div><span>Responsable</span><strong>{estado.caja.usuario_nombre || usuario.nombre}</strong></div>
          </section>

          <section className="caja-print-report">
            <h1>Tienda Tieri</h1>
            <h2>Reporte de caja</h2>
            <p>Fecha de apertura: {new Date(estado.caja.fecha_apertura).toLocaleString()}</p>
            <p>Responsable: {estado.caja.usuario_nombre || usuario.nombre}</p>
            <hr />
            <p>Saldo inicial: {dinero(estado.caja.monto_inicial)}</p>
            <p>Ventas: {dinero(resumen.total_ventas)} ({resumen.cantidad_ventas || 0} operaciones)</p>
            <p>Efectivo: {dinero(resumen.efectivo)}</p>
            <p>QR: {dinero(resumen.qr)}</p>
            <p>Tarjeta: {dinero(resumen.tarjeta)}</p>
            <p>Transferencia: {dinero(resumen.transferencia)}</p>
            <p>Otros: {dinero(resumen.otros)}</p>
            <p>Ingresos adicionales: {dinero(resumen.ingresos_efectivo)}</p>
            <p>Egresos: {dinero(resumen.egresos)}</p>
            <p>Saldo esperado: {dinero(resumen.efectivo_esperado)}</p>
          </section>
        </>
      )}

      {modal && <div className="caja-modal-overlay" onMouseDown={(evento) => evento.target === evento.currentTarget && !guardando && cerrarModal()}>
        <div className="caja-modal" role="dialog" aria-modal="true">
          <div className="caja-modal-header"><div><span className="caja-kicker">{modal === 'apertura' ? 'NUEVA JORNADA' : modal === 'cierre' ? 'CIERRE DIARIO' : 'MOVIMIENTO MANUAL'}</span><h3>{modal === 'apertura' ? 'Abrir caja' : modal === 'cierre' ? 'Cerrar caja' : 'Registrar movimiento'}</h3></div><button className="caja-close" onClick={cerrarModal}>×</button></div>
          <form onSubmit={enviarAccion}>
            <label>{modal === 'cierre' ? 'Efectivo contado' : modal === 'apertura' ? 'Monto inicial' : 'Monto'}<input autoFocus type="number" min="0" step="0.01" value={formulario.monto} onChange={(e) => cambiarFormulario('monto', e.target.value)} required /></label>
            {modal === 'movimiento' && <>
              <label>Tipo<select value={formulario.tipo} onChange={(e) => cambiarFormulario('tipo', e.target.value)}><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></label>
              <label>Método<select value={formulario.metodo} onChange={(e) => cambiarFormulario('metodo', e.target.value)}>{METODOS.map((metodo) => <option key={metodo} value={metodo}>{metodo}</option>)}</select></label>
              <label>Concepto<input type="text" value={formulario.concepto} onChange={(e) => cambiarFormulario('concepto', e.target.value)} placeholder="Ej. cambio, retiro o gasto" required /></label>
            </>}
            {modal === 'cierre' && <label>Observación<textarea value={formulario.observacion} onChange={(e) => cambiarFormulario('observacion', e.target.value)} placeholder="Opcional" rows="3" /></label>}
            <div className="caja-modal-footer"><button type="button" className="caja-button caja-button-secondary" onClick={cerrarModal}>Cancelar</button><button className="caja-button caja-button-primary" disabled={guardando}>{guardando ? 'Guardando...' : 'Confirmar'}</button></div>
          </form>
        </div>
      </div>}
    </section>
  )
}

export default Caja
