import { useEffect, useState } from 'react'

const API = 'http://localhost:3000/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('tieri_token') || ''}`, 'Content-Type': 'application/json' })
const dinero = (valor) => `Bs ${Number(valor || 0).toFixed(2)}`
const vacio = { nombre: '', telefono: '', documento: '', email: '', direccion: '', notas: '' }

function Clientes({ usuario }) {
  const [clientes, setClientes] = useState([])
  const [buscar, setBuscar] = useState('')
  const [formulario, setFormulario] = useState(vacio)
  const [editandoId, setEditandoId] = useState(null)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [cargando, setCargando] = useState(true)
  const [historial, setHistorial] = useState(null)

  const cargar = async () => {
    try {
      const respuesta = await fetch(`${API}/clientes`, { headers: auth() })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudieron cargar los clientes')
      setClientes(datos.clientes || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [usuario.sucursal_id])

  const guardar = async (evento) => {
    evento.preventDefault()
    setError(''); setMensaje('')
    try {
      const respuesta = await fetch(`${API}/clientes${editandoId ? `/${editandoId}` : ''}`, { method: editandoId ? 'PUT' : 'POST', headers: auth(), body: JSON.stringify(formulario) })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo guardar el cliente')
      setMensaje(datos.mensaje)
      setFormulario(vacio)
      setEditandoId(null)
      cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  const editar = (cliente) => {
    setEditandoId(cliente.id)
    setFormulario({ nombre: cliente.nombre || '', telefono: cliente.telefono || '', documento: cliente.documento || '', email: cliente.email || '', direccion: cliente.direccion || '', notas: cliente.notas || '' })
  }

  const cambiarEstado = async (cliente) => {
    const respuesta = await fetch(`${API}/clientes/${cliente.id}/estado`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ activo: !cliente.activo }) })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return setError(datos.mensaje || 'No se pudo cambiar el estado')
    cargar()
  }

  const verHistorial = async (cliente) => {
    setError('')
    try {
      const respuesta = await fetch(`${API}/clientes/${cliente.id}/historial`, { headers: auth() })
      const datos = await respuesta.json()
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo cargar el historial')
      setHistorial(datos)
    } catch (err) {
      setError(err.message)
    }
  }

  const texto = buscar.trim().toLowerCase()
  const filtrados = clientes.filter((c) => !texto || c.nombre?.toLowerCase().includes(texto) || c.telefono?.includes(texto) || c.documento?.toLowerCase().includes(texto))

  if (cargando) return <div className="admin-message">Cargando Clientes...</div>

  return <section className="admin-page">
    <div className="admin-heading">
      <div><span className="ventas-kicker">CARTERA DE CLIENTES</span><h2>Clientes</h2><p>Los clientes se ordenan por cuánto han comprado. El historial se arma solo con las ventas donde escribiste su teléfono o nombre al vender.</p></div>
    </div>
    {error && <div className="ventas-error">{error}</div>}{mensaje && <div className="ventas-success">{mensaje}</div>}

    <div className="admin-grid">
      <form className="admin-card" onSubmit={guardar}>
        <span className="ventas-kicker">{editandoId ? 'EDITAR CLIENTE' : 'NUEVO CLIENTE'}</span><h3>{editandoId ? 'Editar ficha' : 'Crear cliente'}</h3>
        <label>Nombre o razón social<input value={formulario.nombre} onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })} required /></label>
        <label>Teléfono<input value={formulario.telefono} onChange={(e) => setFormulario({ ...formulario, telefono: e.target.value })} placeholder="Úsalo igual que al vender para enlazar sus compras" /></label>
        <label>CI / NIT (opcional)<input value={formulario.documento} onChange={(e) => setFormulario({ ...formulario, documento: e.target.value })} /></label>
        <label>Email (opcional)<input value={formulario.email} onChange={(e) => setFormulario({ ...formulario, email: e.target.value })} /></label>
        <label>Dirección (opcional)<input value={formulario.direccion} onChange={(e) => setFormulario({ ...formulario, direccion: e.target.value })} /></label>
        <label>Notas (opcional)<input value={formulario.notas} onChange={(e) => setFormulario({ ...formulario, notas: e.target.value })} /></label>
        <div className="admin-item-actions">
          <button className="ventas-button ventas-button-primary" type="submit">{editandoId ? 'Guardar cambios' : 'Crear cliente'}</button>
          {editandoId && <button className="secondary-button" type="button" onClick={() => { setEditandoId(null); setFormulario(vacio) }}>Cancelar</button>}
        </div>
      </form>

      <div className="admin-card">
        <span className="ventas-kicker">RANKING</span><h3>Clientes registrados</h3>
        <input placeholder="Buscar por nombre, teléfono o CI/NIT" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ padding: '9px', border: '1px solid #dce8e1', borderRadius: '7px' }} />
        <div className="admin-list">
          {!filtrados.length && <small style={{ color: '#8b9992' }}>No hay clientes que mostrar.</small>}
          {filtrados.map((c, i) => <div className="admin-list-item" key={c.id} style={{ opacity: c.activo ? 1 : 0.55 }}>
            <div>
              <strong>{i === 0 && c.compras > 0 && c.activo ? '🏆 ' : ''}{c.nombre}</strong>
              <small>{c.telefono || 'Sin teléfono'} · {c.compras} compra(s) · {dinero(c.total_comprado)}{c.ultima_compra ? ` · última ${new Date(c.ultima_compra).toLocaleDateString()}` : ''}</small>
            </div>
            <div className="admin-item-actions">
              <button className="secondary-button" onClick={() => verHistorial(c)}>Historial</button>
              <button className="secondary-button" onClick={() => editar(c)}>Editar</button>
              <button className="admin-state" onClick={() => cambiarEstado(c)}>{c.activo ? 'Desactivar' : 'Reactivar'}</button>
            </div>
          </div>)}
        </div>
      </div>
    </div>

    {historial && <div role="presentation" style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,22,0.45)', display: 'grid', placeItems: 'center', zIndex: 60 }} onClick={() => setHistorial(null)}>
      <div role="dialog" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '14px', padding: '22px', width: '92%', maxWidth: '560px', maxHeight: '80vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>{historial.cliente.nombre}</h2>
        <h4>Productos que más compra</h4>
        {!historial.productos_top.length && <small style={{ color: '#8b9992' }}>Todavía no hay compras enlazadas a este cliente.</small>}
        {historial.productos_top.map((p) => <div key={p.nombre} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #eef2ef' }}><span>{p.nombre} <small style={{ color: '#8b9992' }}>({p.veces} vez/veces)</small></span><strong>{dinero(p.total)}</strong></div>)}
        <h4>Últimas compras</h4>
        {historial.ventas.map((v) => <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #eef2ef' }}><span>#{v.id} · {new Date(v.fecha).toLocaleString()} <small style={{ color: '#8b9992' }}>{v.sucursal_nombre} · {v.usuario_nombre}</small></span><strong>{dinero(v.total)}</strong></div>)}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}><button className="secondary-button" onClick={() => setHistorial(null)}>Cerrar</button></div>
      </div>
    </div>}
  </section>
}

export default Clientes
